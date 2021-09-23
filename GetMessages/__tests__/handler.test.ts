// eslint-disable @typescript-eslint/no-explicit-any, sonarjs/no-duplicate-string, sonar/sonar-max-lines-per-function

import * as E from "fp-ts/lib/Either";
import * as O from "fp-ts/lib/Option";
import * as TE from "fp-ts/lib/TaskEither";
import { FiscalCode, NonEmptyString } from "@pagopa/ts-commons/lib/strings";
import {
  MessageModel,
  NewMessageWithoutContent,
  RetrievedMessageWithoutContent
} from "@pagopa/io-functions-commons/dist/src/models/message";
import { TimeToLiveSeconds } from "@pagopa/io-functions-commons/dist/generated/definitions/TimeToLiveSeconds";
import { retrievedMessageToPublic } from "@pagopa/io-functions-commons/dist/src/utils/messages";
import { NonNegativeInteger } from "@pagopa/ts-commons/lib/numbers";
import { aCosmosResourceMetadata } from "../../__mocks__/mocks";
import {
  aRetrievedService,
  aServiceId
} from "../../__mocks__/mocks.service_preference";
import { GetMessagesHandler } from "../handler";
import { MessageContent } from "@pagopa/io-functions-commons/dist/generated/definitions/MessageContent";
import { BlobService } from "azure-storage";
import { ServiceModel } from "@pagopa/io-functions-commons/dist/src/models/service";
import { toCosmosErrorResponse } from "@pagopa/io-functions-commons/dist/src/utils/cosmosdb_model";

const aFiscalCode = "FRLFRC74E04B157I" as FiscalCode;
const aMessageId = "A_MESSAGE_ID" as NonEmptyString;
const aPendingMessageId = "A_PENDING_MESSAGE_ID" as NonEmptyString;

const aNewMessageWithoutContent: NewMessageWithoutContent = {
  createdAt: new Date(),
  fiscalCode: aFiscalCode,
  id: aMessageId,
  indexedId: "A_MESSAGE_ID" as NonEmptyString,
  isPending: false,
  kind: "INewMessageWithoutContent",
  senderServiceId: aServiceId,
  senderUserId: "u123" as NonEmptyString,
  timeToLiveSeconds: 3600 as TimeToLiveSeconds
};

const aRetrievedMessageWithoutContent: RetrievedMessageWithoutContent = {
  ...aNewMessageWithoutContent,
  ...aCosmosResourceMetadata,
  kind: "IRetrievedMessageWithoutContent"
};

const aRetrievedPendingMessageWithoutContent: RetrievedMessageWithoutContent = {
  ...aNewMessageWithoutContent,
  ...aCosmosResourceMetadata,
  id: aPendingMessageId,
  isPending: true,
  kind: "IRetrievedMessageWithoutContent"
};

const blobServiceMock = ({
  getBlobToText: jest.fn()
} as unknown) as BlobService;

const getMockIterator = values => ({
  next: jest
    .fn()
    .mockImplementationOnce(async () => ({
      value: values
    }))
    .mockImplementationOnce(async () => ({ done: true }))
});

const getMessageModelMock = messageIterator =>
  (({
    getContentFromBlob: () =>
      TE.of(
        O.some({
          subject: "a subject",
          markdown: "a markdown"
        } as MessageContent)
      ),
    findMessages: jest.fn(() => TE.of(messageIterator))
  } as unknown) as MessageModel);

const errorMessageModelMock = ({
  getContentFromBlob: jest.fn(() => TE.left("Error blob")),
  findMessages: jest.fn(() => TE.left(toCosmosErrorResponse("Not found")))
} as unknown) as MessageModel;

const serviceModelMock = ({
  findLastVersionByModelId: jest.fn(() => TE.of(O.some(aRetrievedService)))
} as unknown) as ServiceModel;

describe("GetMessagesHandler", () => {
  it("should respond with query error if it cannot retrieve messages", async () => {
    const getMessagesHandler = GetMessagesHandler(
      errorMessageModelMock,
      serviceModelMock,
      blobServiceMock
    );

    const result = await getMessagesHandler(
      aFiscalCode,
      O.none,
      O.none,
      O.none,
      O.none
    );
    expect(result.kind).toBe("IResponseErrorQuery");
  });

  it("should respond with the messages for the recipient when no parameters are given", async () => {
    const messages = [E.right(aRetrievedMessageWithoutContent)];
    const messageIterator = getMockIterator(messages);
    const messageModelMock = getMessageModelMock(messageIterator);

    const getMessagesHandler = GetMessagesHandler(
      messageModelMock,
      serviceModelMock,
      blobServiceMock
    );

    const result = await getMessagesHandler(
      aFiscalCode,
      O.none,
      O.none,
      O.none,
      O.none
    );
    expect(result.kind).toBe("IResponseSuccessJson");
    expect(messageIterator.next).toHaveBeenCalledTimes(2);
  });

  it("should respond only with non-pending messages", async () => {
    const messages = [
      E.right(aRetrievedMessageWithoutContent),
      E.right(aRetrievedPendingMessageWithoutContent)
    ];
    const messageIterator = getMockIterator(messages);
    const messageModelMock = getMessageModelMock(messageIterator);

    const getMessagesHandler = GetMessagesHandler(
      messageModelMock,
      serviceModelMock,
      blobServiceMock
    );

    const result = await getMessagesHandler(
      aFiscalCode,
      O.none,
      O.none,
      O.none,
      O.none
    );
    expect(result.kind).toBe("IResponseSuccessJson");

    if (result.kind === "IResponseSuccessJson") {
      expect(result.value).toEqual({
        items: [retrievedMessageToPublic(aRetrievedMessageWithoutContent)],
        prev: aRetrievedMessageWithoutContent.id,
        next: undefined
      });
    }

    expect(messageIterator.next).toHaveBeenCalledTimes(2);
  });

  it("should respond with a page of given page size", async () => {
    const messages = [
      E.right(aRetrievedMessageWithoutContent),
      E.right(aRetrievedMessageWithoutContent),
      E.right(aRetrievedMessageWithoutContent),
      E.right(aRetrievedMessageWithoutContent),
      E.right(aRetrievedPendingMessageWithoutContent)
    ];
    const messageIterator = getMockIterator(messages);
    const messageModelMock = getMessageModelMock(messageIterator);

    const getMessagesHandler = GetMessagesHandler(
      messageModelMock,
      serviceModelMock,
      blobServiceMock
    );
    const pageSize = 2 as NonNegativeInteger;

    const result = await getMessagesHandler(
      aFiscalCode,
      O.some(pageSize),
      O.none,
      O.none,
      O.none
    );

    expect(result.kind).toBe("IResponseSuccessJson");

    if (result.kind === "IResponseSuccessJson") {
      expect(result.value).toEqual({
        items: [
          aRetrievedMessageWithoutContent,
          aRetrievedMessageWithoutContent
        ].map(retrievedMessageToPublic),
        prev: aRetrievedMessageWithoutContent.id,
        next: aRetrievedMessageWithoutContent.id
      });
    }

    expect(messageIterator.next).toHaveBeenCalledTimes(1);
  });

  it("should respond with a page of messages when given maximum id", async () => {
    const messages = [
      E.right(aRetrievedMessageWithoutContent),
      E.right(aRetrievedMessageWithoutContent),
      E.right(aRetrievedMessageWithoutContent),
      E.right(aRetrievedMessageWithoutContent),
      E.right(aRetrievedMessageWithoutContent),
      E.right(aRetrievedPendingMessageWithoutContent)
    ];
    const messageIterator = getMockIterator(messages);
    const messageModelMock = getMessageModelMock(messageIterator);

    const getMessagesHandler = GetMessagesHandler(
      messageModelMock,
      serviceModelMock,
      blobServiceMock
    );

    const pageSize = 2 as NonNegativeInteger;

    const result = await getMessagesHandler(
      aFiscalCode,
      O.some(pageSize),
      O.none,
      O.some(aRetrievedMessageWithoutContent.id),
      O.none
    );
    expect(result.kind).toBe("IResponseSuccessJson");

    if (result.kind === "IResponseSuccessJson") {
      expect(result.value).toEqual({
        items: [
          aRetrievedMessageWithoutContent,
          aRetrievedMessageWithoutContent
        ].map(retrievedMessageToPublic),
        prev: aRetrievedMessageWithoutContent.id,
        next: aRetrievedMessageWithoutContent.id
      });
    }

    expect(messageIterator.next).toHaveBeenCalledTimes(1);
  });

  it("should respond with a page of messages above given minimum id", async () => {
    const messages = [
      E.right(aRetrievedMessageWithoutContent),
      E.right(aRetrievedMessageWithoutContent),
      E.right(aRetrievedMessageWithoutContent),
      E.right(aRetrievedMessageWithoutContent),
      E.right(aRetrievedMessageWithoutContent),
      E.right(aRetrievedPendingMessageWithoutContent)
    ];
    const messageIterator = getMockIterator(messages);
    const messageModelMock = getMessageModelMock(messageIterator);

    const getMessagesHandler = GetMessagesHandler(
      messageModelMock,
      serviceModelMock,
      blobServiceMock
    );

    const pageSize = 2 as NonNegativeInteger;

    const result = await getMessagesHandler(
      aFiscalCode,
      O.some(pageSize),
      O.none,
      O.none,
      O.some(aRetrievedMessageWithoutContent.id)
    );

    expect(result.kind).toBe("IResponseSuccessJson");

    if (result.kind === "IResponseSuccessJson") {
      expect(result.value).toEqual({
        items: [
          aRetrievedMessageWithoutContent,
          aRetrievedMessageWithoutContent
        ].map(retrievedMessageToPublic),
        prev: aRetrievedMessageWithoutContent.id,
        next: aRetrievedMessageWithoutContent.id
      });
    }

    expect(messageIterator.next).toHaveBeenCalledTimes(1);
  });

  it("should respond with undefined next when last element of the page is the last of all", async () => {
    const messages = [
      E.right(aRetrievedMessageWithoutContent),
      E.right(aRetrievedMessageWithoutContent)
    ];
    const messageIterator = getMockIterator(messages);
    const messageModelMock = getMessageModelMock(messageIterator);

    const getMessagesHandler = GetMessagesHandler(
      messageModelMock,
      serviceModelMock,
      blobServiceMock
    );

    const pageSize = 2 as NonNegativeInteger;

    const result = await getMessagesHandler(
      aFiscalCode,
      O.some(pageSize),
      O.none,
      O.none,
      O.some(aRetrievedMessageWithoutContent.id)
    );

    expect(result.kind).toBe("IResponseSuccessJson");

    if (result.kind === "IResponseSuccessJson") {
      expect(result.value).toEqual({
        items: [
          aRetrievedMessageWithoutContent,
          aRetrievedMessageWithoutContent
        ].map(retrievedMessageToPublic),
        prev: aRetrievedMessageWithoutContent.id,
        next: undefined
      });
    }

    expect(messageIterator.next).toHaveBeenCalledTimes(2);
  });

  it("should respond with a page of messages when given enrichment parameter", async () => {
    const messages = [
      E.right(aRetrievedMessageWithoutContent),
      E.right(aRetrievedMessageWithoutContent),
      E.right(aRetrievedMessageWithoutContent),
      E.right(aRetrievedMessageWithoutContent),
      E.right(aRetrievedMessageWithoutContent),
      E.right(aRetrievedPendingMessageWithoutContent)
    ];
    const messageIterator = getMockIterator(messages);
    const messageModelMock = getMessageModelMock(messageIterator);

    const getMessagesHandler = GetMessagesHandler(
      messageModelMock,
      serviceModelMock,
      blobServiceMock
    );

    const pageSize = 2 as NonNegativeInteger;

    const result = await getMessagesHandler(
      aFiscalCode,
      O.some(pageSize),
      O.some(true),
      O.none,
      O.none
    );

    expect(result.kind).toBe("IResponseSuccessJson");

    const expectedEnrichedMessage = {
      ...retrievedMessageToPublic(aRetrievedMessageWithoutContent),
      message_title: "a subject",
      organization_name: aRetrievedService.organizationName,
      service_name: aRetrievedService.serviceName
    };

    if (result.kind === "IResponseSuccessJson") {
      expect(result.value).toEqual({
        items: [expectedEnrichedMessage, expectedEnrichedMessage],
        prev: aRetrievedMessageWithoutContent.id,
        next: aRetrievedMessageWithoutContent.id
      });
    }

    expect(messageIterator.next).toHaveBeenCalledTimes(1);
  });

  it("should respond with internal error when messages cannot be enriched", async () => {
    const messages = [
      E.right(aRetrievedMessageWithoutContent),
      E.right(aRetrievedMessageWithoutContent),
      E.right(aRetrievedMessageWithoutContent),
      E.right(aRetrievedMessageWithoutContent),
      E.right(aRetrievedMessageWithoutContent),
      E.right(aRetrievedPendingMessageWithoutContent)
    ];
    const messageIterator = getMockIterator(messages);
    const messageModelMock = getMessageModelMock(messageIterator);

    serviceModelMock.findLastVersionByModelId = jest
      .fn()
      .mockImplementationOnce(() => {
        throw Error();
      });

    const getMessagesHandler = GetMessagesHandler(
      messageModelMock,
      serviceModelMock,
      blobServiceMock
    );

    const pageSize = 2 as NonNegativeInteger;

    const result = await getMessagesHandler(
      aFiscalCode,
      O.some(pageSize),
      O.some(true),
      O.none,
      O.none
    );

    expect(result.kind).toBe("IResponseErrorInternal");
    expect(messageIterator.next).toHaveBeenCalledTimes(1);
  });
});
