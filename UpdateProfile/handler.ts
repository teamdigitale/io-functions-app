import * as express from "express";

import { Context } from "@azure/functions";
import * as df from "durable-functions";

import { isLeft } from "fp-ts/lib/Either";
import { fromNullable, isNone } from "fp-ts/lib/Option";

import {
  IResponseErrorConflict,
  IResponseErrorInternal,
  IResponseErrorNotFound,
  IResponseSuccessJson,
  ResponseErrorConflict,
  ResponseErrorNotFound,
  ResponseSuccessJson
} from "@pagopa/ts-commons/lib/responses";
import { FiscalCode } from "@pagopa/ts-commons/lib/strings";
import { withoutUndefinedValues } from "@pagopa/ts-commons/lib/types";

import { Profile as ApiProfile } from "@pagopa/io-functions-commons/dist/generated/definitions/Profile";
import { ProfileModel } from "@pagopa/io-functions-commons/dist/src/models/profile";
import {
  IResponseErrorQuery,
  ResponseErrorQuery
} from "@pagopa/io-functions-commons/dist/src/utils/response";

import { ContextMiddleware } from "@pagopa/io-functions-commons/dist/src/utils/middlewares/context_middleware";
import { FiscalCodeMiddleware } from "@pagopa/io-functions-commons/dist/src/utils/middlewares/fiscalcode";
import {
  withRequestMiddlewares,
  wrapRequestHandler
} from "@pagopa/io-functions-commons/dist/src/utils/request_middleware";

import { ServicesPreferencesModeEnum } from "@pagopa/io-functions-commons/dist/generated/definitions/ServicesPreferencesMode";
import { MigrateServicesPreferencesQueueMessage } from "../MigrateServicePreferenceFromLegacy/handler";
import { OrchestratorInput as UpsertedProfileOrchestratorInput } from "../UpsertedProfileOrchestrator/handler";
import { ProfileMiddleware } from "../utils/middlewares/profile";
import {
  apiProfileToProfile,
  retrievedProfileToExtendedProfile
} from "../utils/profiles";

/**
 * Type of an UpdateProfile handler.
 */
type IUpdateProfileHandler = (
  context: Context,
  fiscalCode: FiscalCode,
  profilePayload: ApiProfile
) => Promise<
  // tslint:disable-next-line: max-union-size
  | IResponseSuccessJson<ApiProfile>
  | IResponseErrorQuery
  | IResponseErrorNotFound
  | IResponseErrorConflict
  | IResponseErrorInternal
>;

// tslint:disable-next-line: cognitive-complexity
export function UpdateProfileHandler(
  profileModel: ProfileModel
): IUpdateProfileHandler {
  return async (context, fiscalCode, profilePayload) => {
    const logPrefix = `UpdateProfileHandler|FISCAL_CODE=${fiscalCode}`;

    const errorOrMaybeExistingProfile = await profileModel
      .findLastVersionByModelId([fiscalCode])
      .run();

    if (isLeft(errorOrMaybeExistingProfile)) {
      return ResponseErrorQuery(
        "Error trying to retrieve existing profile",
        errorOrMaybeExistingProfile.value
      );
    }

    const maybeExistingProfile = errorOrMaybeExistingProfile.value;
    if (isNone(maybeExistingProfile)) {
      return ResponseErrorNotFound(
        "Error",
        "Could not find a profile with the provided fiscalcode"
      );
    }

    const existingProfile = maybeExistingProfile.value;

    // Verify that the client asked to update the latest version
    if (profilePayload.version !== existingProfile.version) {
      context.log.warn(
        `${logPrefix}|CURRENT_VERSION=${existingProfile.version}|RESULT=CONFLICT`
      );
      return ResponseErrorConflict(
        `Version ${profilePayload.version} is not the latest version.`
      );
    }

    // Check if the email has been changed
    const emailChanged =
      profilePayload.email !== undefined &&
      profilePayload.email !== existingProfile.email;

    // Get servicePreferencesSettings mode from payload or default to LEGACY
    const requestedServicePreferencesSettingsMode = fromNullable(
      profilePayload.service_preferences_settings
    )
      .map(_ => _.mode)
      .getOrElse(ServicesPreferencesModeEnum.LEGACY);

    // Check if a mode change is requested
    const isServicePreferencesSettingsModeChanged =
      requestedServicePreferencesSettingsMode !==
      existingProfile.servicePreferencesSettings.mode;

    // return to LEGACY profile from updated ones is forbidden
    if (
      isServicePreferencesSettingsModeChanged &&
      requestedServicePreferencesSettingsMode ===
        ServicesPreferencesModeEnum.LEGACY
    ) {
      context.log.warn(
        `${logPrefix}|REQUESTED_MODE=${requestedServicePreferencesSettingsMode}|CURRENT_MODE=${existingProfile.servicePreferencesSettings.mode}|RESULT=CONFLICT`
      );
      return ResponseErrorConflict(
        `Mode ${requestedServicePreferencesSettingsMode} is not valid.`
      );
    }

    const servicePreferencesSettingsVersion = isServicePreferencesSettingsModeChanged
      ? Number(existingProfile.servicePreferencesSettings.version) + 1
      : existingProfile.servicePreferencesSettings.version;

    const profile = apiProfileToProfile(
      profilePayload,
      fiscalCode,
      emailChanged ? false : existingProfile.isEmailValidated,
      servicePreferencesSettingsVersion
    );

    // User inbox and webhook must be enabled after accepting the ToS for the first time
    // https://www.pivotaltracker.com/story/show/175095963
    const autoEnableInboxAndWebHook =
      existingProfile.acceptedTosVersion === undefined &&
      profile.acceptedTosVersion !== undefined;
    const overriddenInboxAndWebhook = autoEnableInboxAndWebHook
      ? { isInboxEnabled: true, isWebhookEnabled: true }
      : {};

    const errorOrMaybeUpdatedProfile = await profileModel
      .update({
        ...existingProfile,
        // Remove undefined values to avoid overriding already existing profile properties
        ...withoutUndefinedValues(profile),
        ...overriddenInboxAndWebhook
      })
      .run();

    if (isLeft(errorOrMaybeUpdatedProfile)) {
      context.log.error(
        `${logPrefix}|ERROR=${errorOrMaybeUpdatedProfile.value.kind}`
      );
      return ResponseErrorQuery(
        "Error while updating the existing profile",
        errorOrMaybeUpdatedProfile.value
      );
    }

    const updateProfile = errorOrMaybeUpdatedProfile.value;

    const dfClient = df.getClient(context);

    // Start the Orchestrator
    const upsertedProfileOrchestratorInput = UpsertedProfileOrchestratorInput.encode(
      {
        newProfile: updateProfile,
        oldProfile: existingProfile,
        updatedAt: new Date()
      }
    );
    await dfClient.startNew(
      "UpsertedProfileOrchestrator",
      undefined,
      upsertedProfileOrchestratorInput
    );

    // Queue services preferences migration
    if (
      existingProfile.servicePreferencesSettings.mode ===
        ServicesPreferencesModeEnum.LEGACY &&
      updateProfile.servicePreferencesSettings.mode ===
        ServicesPreferencesModeEnum.AUTO
    ) {
      await dfClient.startNew(
        "MigrateServicesPreferencesOrchestrator",
        undefined,
        MigrateServicesPreferencesQueueMessage.encode({
          newProfile: updateProfile,
          oldProfile: existingProfile
        })
      );
    }

    return ResponseSuccessJson(
      retrievedProfileToExtendedProfile(updateProfile)
    );
  };
}

/**
 * Wraps an UpdateProfile handler inside an Express request handler.
 */
export function UpdateProfile(
  profileModel: ProfileModel
): express.RequestHandler {
  const handler = UpdateProfileHandler(profileModel);

  const middlewaresWrap = withRequestMiddlewares(
    ContextMiddleware(),
    FiscalCodeMiddleware,
    ProfileMiddleware
  );
  return wrapRequestHandler(middlewaresWrap(handler));
}
