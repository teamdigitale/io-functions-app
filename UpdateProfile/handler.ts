import * as express from "express";

import { Context } from "@azure/functions";
import * as df from "durable-functions";

import { isLeft } from "fp-ts/lib/Either";
import { isNone } from "fp-ts/lib/Option";

import {
  IResponseErrorConflict,
  IResponseErrorInternal,
  IResponseErrorNotFound,
  IResponseSuccessJson,
  ResponseErrorConflict,
  ResponseErrorInternal,
  ResponseErrorNotFound,
  ResponseSuccessJson
} from "italia-ts-commons/lib/responses";
import { FiscalCode } from "italia-ts-commons/lib/strings";
import { withoutUndefinedValues } from "italia-ts-commons/lib/types";

import { Profile as ApiProfile } from "io-functions-commons/dist/generated/definitions/Profile";
import {
  ProfileModel,
  RetrievedProfile,
  NewProfile
} from "io-functions-commons/dist/src/models/profile";
import {
  IResponseErrorQuery,
  ResponseErrorQuery
} from "io-functions-commons/dist/src/utils/response";

import { ContextMiddleware } from "io-functions-commons/dist/src/utils/middlewares/context_middleware";
import { FiscalCodeMiddleware } from "io-functions-commons/dist/src/utils/middlewares/fiscalcode";
import {
  withRequestMiddlewares,
  wrapRequestHandler
} from "io-functions-commons/dist/src/utils/request_middleware";

import { OrchestratorInput as UpsertedProfileOrchestratorInput } from "../UpsertedProfileOrchestrator/handler";
import { ProfileMiddleware } from "../utils/middlewares/profile";
import {
  apiProfileToProfile,
  retrievedProfileToExtendedProfile
} from "../utils/profiles";
import { fromEither } from "fp-ts/lib/TaskEither";
import {
  CosmosErrors,
  CosmosDecodingError
} from "io-functions-commons/dist/src/utils/cosmosdb_model";

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

export function UpdateProfileHandler(
  profileModel: ProfileModel
): IUpdateProfileHandler {
  return async (context, fiscalCode, profilePayload) => {
    const logPrefix = `UpdateProfileHandler|FISCAL_CODE=${fiscalCode}`;

    const errorOrMaybeExistingProfile = await profileModel
      .findLastVersionByModelId(fiscalCode)
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

    const profile = apiProfileToProfile(
      profilePayload,
      fiscalCode,
      emailChanged ? false : existingProfile.isEmailValidated
    );

    // Remove undefined values to avoid overriding already existing profile properties
    const profileWithoutUndefinedValues = withoutUndefinedValues(profile);

    const errorOrMaybeUpdatedProfile = await fromEither(
      NewProfile.decode({
        ...existingProfile,
        ...profileWithoutUndefinedValues,
        kind: "INewProfile"
      })
    )
      .mapLeft<CosmosErrors>(CosmosDecodingError)
      .chain(profileModel.upsert)
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

    // Start the Orchestrator
    const upsertedProfileOrchestratorInput = UpsertedProfileOrchestratorInput.encode(
      {
        newProfile: updateProfile,
        oldProfile: existingProfile,
        updatedAt: new Date()
      }
    );

    const dfClient = df.getClient(context);
    await dfClient.startNew(
      "UpsertedProfileOrchestrator",
      undefined,
      upsertedProfileOrchestratorInput
    );

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
