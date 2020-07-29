/* tslint:disable:no-any */

import { none, some } from "fp-ts/lib/Option";
import { fromLeft, taskEither } from "fp-ts/lib/TaskEither";
import { context as contextMock } from "../../__mocks__/durable-functions";
import {
  aFiscalCode,
  aRetrievedUserDataProcessing,
  aUserDataProcessingApi,
  aUserDataProcessingChoice,
  aUserDataProcessingId
} from "../../__mocks__/mocks";
import { GetUserDataProcessingHandler } from "../handler";

describe("GetUserDataProcessingHandler", () => {
  it("should find an existing User data processing", async () => {
    const userDataProcessingModelMock = {
      findLastVersionByModelId: jest.fn(() => {
        return taskEither.of(some(aRetrievedUserDataProcessing));
      })
    };

    const getUserDataProcessingHandler = GetUserDataProcessingHandler(
      userDataProcessingModelMock as any
    );

    const response = await getUserDataProcessingHandler(
      contextMock as any,
      aFiscalCode,
      aUserDataProcessingChoice
    );

    expect(
      userDataProcessingModelMock.findLastVersionByModelId
    ).toHaveBeenCalledWith(aUserDataProcessingId);
    expect(response.kind).toBe("IResponseSuccessJson");
    if (response.kind === "IResponseSuccessJson") {
      expect(response.value).toEqual(aUserDataProcessingApi);
    }
  });

  it("should respond with NotFound if userDataProcessing does not exist", async () => {
    const userDataProcessingModelMock = {
      findLastVersionByModelId: jest.fn(() => {
        return taskEither.of(none);
      })
    };

    const getUserDataProcessingHandler = GetUserDataProcessingHandler(
      userDataProcessingModelMock as any
    );

    const response = await getUserDataProcessingHandler(
      contextMock as any,
      aFiscalCode,
      aUserDataProcessingChoice
    );
    expect(
      userDataProcessingModelMock.findLastVersionByModelId
    ).toHaveBeenCalledWith(aUserDataProcessingId);
    expect(response.kind).toBe("IResponseErrorNotFound");
  });

  it("should reject the promise in case of errors", async () => {
    const userDataProcessingModelMock = {
      findLastVersionByModelId: jest.fn(() => {
        return fromLeft("error");
      })
    };

    const getUserDataProcessingHandler = GetUserDataProcessingHandler(
      userDataProcessingModelMock as any
    );

    const result = await getUserDataProcessingHandler(
      contextMock as any,
      aFiscalCode,
      aUserDataProcessingChoice
    );

    return expect(result.kind).toBe("IResponseErrorQuery");
  });
});
