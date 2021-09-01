import { Context } from "@azure/functions";
import { BlockedInboxOrChannelEnum } from "@pagopa/io-functions-commons/dist/generated/definitions/BlockedInboxOrChannel";
import { RetrievedProfile } from "@pagopa/io-functions-commons/dist/src/models/profile";
import {
  makeServicesPreferencesDocumentId,
  NewServicePreference,
  ServicesPreferencesModel
} from "@pagopa/io-functions-commons/dist/src/models/service_preference";
import {
  CosmosErrorResponse,
  CosmosErrors
} from "@pagopa/io-functions-commons/dist/src/utils/cosmosdb_model";
import { NonNegativeInteger } from "@pagopa/ts-commons/lib/numbers";
import * as a from "fp-ts/lib/Array";
import * as e from "fp-ts/lib/Either";
import { pipe } from "fp-ts/lib/function";
import * as o from "fp-ts/lib/Option";
import * as te from "fp-ts/lib/TaskEither";
import * as t from "io-ts";
import { FiscalCode } from "../generated/backend/FiscalCode";
import { ServiceId } from "../generated/backend/ServiceId";
import { errorsToError } from "../utils/conversions";
import { createTracker } from "../utils/tracking";

const COSMOS_ERROR_KIND = "COSMOS_ERROR_RESPONSE";
const CONFLICT_CODE = 409;
const LOG_PREFIX = "MigrateServicePreferenceFromLegacy";

export const MigrateServicesPreferencesQueueMessage = t.interface({
  newProfile: RetrievedProfile,
  oldProfile: RetrievedProfile
});
export type MigrateServicesPreferencesQueueMessage = t.TypeOf<
  typeof MigrateServicesPreferencesQueueMessage
>;

function isCosmosError(
  ce: CosmosErrors
): ce is ReturnType<typeof CosmosErrorResponse> {
  return ce.kind === COSMOS_ERROR_KIND;
}

export const createServicePreference = (
  serviceId: ServiceId,
  blockedChannels: ReadonlyArray<BlockedInboxOrChannelEnum>,
  fiscalCode: FiscalCode,
  version: NonNegativeInteger
): NewServicePreference => ({
  fiscalCode,
  id: makeServicesPreferencesDocumentId(fiscalCode, serviceId, version),
  isEmailEnabled: !blockedChannels.includes(BlockedInboxOrChannelEnum.EMAIL),
  isInboxEnabled: !blockedChannels.includes(BlockedInboxOrChannelEnum.INBOX),
  isWebhookEnabled: !blockedChannels.includes(
    BlockedInboxOrChannelEnum.WEBHOOK
  ),
  kind: "INewServicePreference",
  serviceId,
  settingsVersion: version
});

export const blockedsToServicesPreferences = (
  blocked: {
    [x: string]: readonly BlockedInboxOrChannelEnum[];
  },
  fiscalCode: FiscalCode,
  version: NonNegativeInteger
) =>
  pipe(
    o.fromNullable(blocked),
    o.map(b =>
      Object.entries(b)
        // tslint:disable-next-line: readonly-array
        .filter((_): _ is [
          ServiceId,
          ReadonlyArray<BlockedInboxOrChannelEnum>
        ] => ServiceId.is(_[0]))
        .map(([serviceId, blockedInboxOrChannelsForService]) =>
          createServicePreference(
            serviceId,
            blockedInboxOrChannelsForService,
            fiscalCode,
            version
          )
        )
    ),
    o.getOrElse(() => [])
  );

export const MigrateServicePreferenceFromLegacy = (
  servicePreferenceModel: ServicesPreferencesModel,
  tracker: ReturnType<typeof createTracker>
) => async (context: Context, input: unknown) =>
  pipe(
    MigrateServicesPreferencesQueueMessage.decode(input),
    e.mapLeft(errorsToError),
    te.fromEither,
    x => x,
    // trace event
    te.map(_ => {
      tracker.profile.traceMigratingServicePreferences(
        _.oldProfile,
        _.newProfile,
        "DOING"
      );
      return _;
    }),
    te.filterOrElse(
      migrateInput =>
        NonNegativeInteger.is(
          migrateInput.newProfile.servicePreferencesSettings.version
        ),
      () =>
        new Error("Can not migrate to negative services preferences version.")
    ),
    te.chain(migrateInput => {
      const tasks = blockedsToServicesPreferences(
        migrateInput.oldProfile.blockedInboxOrChannels,
        migrateInput.newProfile.fiscalCode,
        // tslint:disable-next-line: no-useless-cast
        migrateInput.newProfile.servicePreferencesSettings
          .version as NonNegativeInteger // cast required: ts do not identify filterOrElse as a guard
      ).map(preference =>
        pipe(
          servicePreferenceModel.create(preference),
          te.fold(
            cosmosError =>
              isCosmosError(cosmosError) &&
              cosmosError.error.code === CONFLICT_CODE
                ? te.of<Error, boolean>(false)
                : te.left(
                    new Error(
                      `Can not create the service preferences: ${JSON.stringify(
                        cosmosError
                      )}`
                    )
                  ),
            _ => te.of<Error, boolean>(true)
          )
        )
      );
      return pipe(
        a.array.sequence(te.ApplicativeSeq)(tasks),
        te.map(_ => {
          tracker.profile.traceMigratingServicePreferences(
            migrateInput.oldProfile,
            migrateInput.newProfile,
            "DONE"
          );
          return _;
        })
      );
    }),
    te.getOrElse(error => {
      context.log.error(`${LOG_PREFIX}|ERROR|${error}`);
      throw error;
    })
  )();
