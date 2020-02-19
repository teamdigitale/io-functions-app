/**
 * Insert fake data into CosmosDB database emulator.
 */
import {
  CollectionMeta,
  DocumentClient as DocumentDBClient,
  UriFactory
} from "documentdb";
import { Either, left, right } from "fp-ts/lib/Either";
import { UserDataProcessing } from "io-functions-commons/dist/generated/definitions/UserDataProcessing";
import { UserDataProcessingChoiceEnum } from "io-functions-commons/dist/generated/definitions/UserDataProcessingChoice";
import { UserDataProcessingStatusEnum } from "io-functions-commons/dist/generated/definitions/UserDataProcessingStatus";
import {
  Service,
  SERVICE_COLLECTION_NAME,
  ServiceModel
} from "io-functions-commons/dist/src/models/service";
import {
  USER_DATA_PROCESSING_COLLECTION_NAME,
  UserDataProcessingModel
} from "io-functions-commons/dist/src/models/user_data_processing";
import * as documentDbUtils from "io-functions-commons/dist/src/utils/documentdb";
import { getRequiredStringEnv } from "io-functions-commons/dist/src/utils/env";
import { ulidGenerator } from "io-functions-commons/dist/src/utils/strings";
import { NonNegativeNumber } from "italia-ts-commons/lib/numbers";
import { aFiscalCode } from "../../__mocks__/mocks";

const cosmosDbKey = getRequiredStringEnv("CUSTOMCONNSTR_COSMOSDB_KEY");
const cosmosDbUri = getRequiredStringEnv("CUSTOMCONNSTR_COSMOSDB_URI");
const cosmosDbName = getRequiredStringEnv("COSMOSDB_NAME");

const documentDbDatabaseUrl = documentDbUtils.getDatabaseUri(cosmosDbName);
const servicesCollectionUrl = documentDbUtils.getCollectionUri(
  documentDbDatabaseUrl,
  SERVICE_COLLECTION_NAME
);

const userDataProcessingCollectionUrl = documentDbUtils.getCollectionUri(
  documentDbDatabaseUrl,
  USER_DATA_PROCESSING_COLLECTION_NAME
);

const documentClient = new DocumentDBClient(cosmosDbUri, {
  masterKey: cosmosDbKey
});

function createDatabase(databaseName: string): Promise<Either<Error, void>> {
  return new Promise(resolve => {
    documentClient.createDatabase({ id: databaseName }, (err, _) => {
      if (err) {
        return resolve(left<Error, void>(new Error(err.body)));
      }
      resolve(right<Error, void>(void 0));
    });
  });
}

function createCollection(
  collectionName: string,
  partitionKey: string
): Promise<Either<Error, CollectionMeta>> {
  return new Promise(resolve => {
    const dbUri = UriFactory.createDatabaseUri(cosmosDbName);
    documentClient.createCollection(
      dbUri,
      {
        id: collectionName,
        partitionKey: {
          kind: "Hash",
          paths: [`/${partitionKey}`]
        }
      },
      (err, ret) => {
        if (err) {
          return resolve(left<Error, CollectionMeta>(new Error(err.body)));
        }
        resolve(right<Error, CollectionMeta>(ret));
      }
    );
  });
}

const serviceModel = new ServiceModel(documentClient, servicesCollectionUrl);

const aService: Service = Service.decode({
  authorizedCIDRs: [],
  authorizedRecipients: [],
  departmentName: "Deparment Name",
  isVisible: true,
  maxAllowedPaymentAmount: 100000,
  organizationFiscalCode: "01234567890",
  organizationName: "Organization name",
  requireSecureChannels: false,
  serviceId: process.env.REQ_SERVICE_ID,
  serviceName: "MyServiceName"
}).getOrElseL(() => {
  throw new Error("Cannot decode service payload.");
});

const userDataProcessingModel = new UserDataProcessingModel(
  documentClient,
  userDataProcessingCollectionUrl
);

const aUserDataProcessing: UserDataProcessing = UserDataProcessing.decode({
  id: ulidGenerator(),
  // tslint:disable-next-line: object-literal-sort-keys
  fiscalCode: aFiscalCode,
  choice: UserDataProcessingChoiceEnum.DOWNLOAD,
  status: UserDataProcessingStatusEnum.PENDING,
  createdAt: new Date(),
  version: 0 as NonNegativeNumber
}).getOrElseL(() => {
  throw new Error("Cannot decode user data processing payload.");
});

// tslint:disable-next-line: no-floating-promises
createDatabase(cosmosDbName)
  .then(() => createCollection("message-status", "messageId"))
  .then(() => createCollection("messages", "messageId"))
  .then(() => createCollection("notification-status", "notificationId"))
  .then(() => createCollection("notifications", "messageId"))
  .then(() => createCollection("profiles", "fiscalCode"))
  .then(() => createCollection("sender-services", "recipientFiscalCode"))
  .then(() => createCollection("services", "serviceId"))
  .then(() => createCollection("user-data-processing", "fiscalCode"))
  .then(() => serviceModel.create(aService, aService.serviceId))
  .then(() =>
    userDataProcessingModel.create(
      aUserDataProcessing,
      aUserDataProcessing.fiscalCode
    )
  )
  // tslint:disable-next-line: no-console
  .then(s => console.log(s.value))
  // tslint:disable-next-line: no-console
  .catch(console.error);
