import { Context } from "@azure/functions";
import { AzureContextTransport } from "io-functions-commons/dist/src/utils/logging";
import * as t from "io-ts";
import { UTCISODateFromString } from "italia-ts-commons/lib/dates";
import { readableReport } from "italia-ts-commons/lib/reporters";
import { IPString, PatternString } from "italia-ts-commons/lib/strings";
import * as winston from "winston";

/**
 * Payload of the stored blob item
 * (one for each SPID request or response).
 */
const SpidBlobItem = t.interface({
  // Timestamp of Request/Response creation
  createdAt: UTCISODateFromString,

  // IP of the client that made a SPID login action
  ip: IPString,

  // XML payload of the SPID Request/Response
  payload: t.string,

  // Payload type: REQUEST or RESPONSE
  payloadType: t.keyof({ REQUEST: null, RESPONSE: null }),

  // SPID request ID
  spidRequestId: t.string
});

export type SpidBlobItem = t.TypeOf<typeof SpidBlobItem>;

/**
 * Payload of the message retrieved from the queue
 * (one for each SPID request or response).
 */
const SpidMsgItem = t.intersection([
  t.interface({
    // Date of the SPID request / response in YYYY-MM-DD format
    createdAtDay: PatternString("^[0-9]{4}-[0-9]{2}-[0-9]{2}$")
  }),
  SpidBlobItem,
  t.partial({
    // SPID user fiscal code
    fiscalCode: t.string
  })
]);

export type SpidMsgItem = t.TypeOf<typeof SpidMsgItem>;

// tslint:disable-next-line: no-let
let logger: Context["log"] | undefined;
const contextTransport = new AzureContextTransport(() => logger, {
  level: "debug"
});
winston.add(contextTransport);

/**
 * Store SPID request / responses, read from a queue, into a blob storage.
 */
export async function index(
  context: Context,
  spidMsgItem: SpidMsgItem
): Promise<void | SpidBlobItem> {
  logger = context.log;
  return t
    .exact(SpidBlobItem)
    .decode(spidMsgItem)
    .fold(
      errs => {
        context.log.error(
          `StoreSpidLogs|ERROR=Cannot decode payload|ERROR_DETAILS=${readableReport(
            errs
          )}`
        );
        // unrecoverable error
        return void 0;
      },
      spidBlobItem => {
        if (spidMsgItem.payloadType === "RESPONSE") {
          // tslint:disable-next-line: no-object-mutation
          context.bindings.spidResponse = spidBlobItem;
        } else {
          // tslint:disable-next-line: no-object-mutation
          context.bindings.spidRequest = spidBlobItem;
        }
        return spidBlobItem;
      }
    );
}
