import * as express from "express";

import { Context } from "@azure/functions";

import { isLeft } from "fp-ts/lib/Either";

import {
  HttpStatusCodeEnum,
  IResponseErrorConflict,
  IResponseErrorGeneric,
  IResponseSuccessJson,
  ResponseErrorGeneric,
  ResponseSuccessJson
} from "italia-ts-commons/lib/responses";
import { FiscalCode } from "italia-ts-commons/lib/strings";

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

import {
  UserDataProcessingChoice,
  UserDataProcessingChoiceEnum
} from "io-functions-commons/dist/generated/definitions/UserDataProcessingChoice";
import { UserDataProcessingChoiceRequest } from "io-functions-commons/dist/generated/definitions/UserDataProcessingChoiceRequest";
import { UserDataProcessingStatusEnum } from "io-functions-commons/dist/generated/definitions/UserDataProcessingStatus";
import {
  makeUserDataProcessingId,
  UserDataProcessing,
  UserDataProcessingModel
} from "io-functions-commons/dist/src/models/user_data_processing";
import { UserDataProcessingChoiceMiddleware } from "../utils/middlewares/userDataProcessing";

/**
 * Type of an CreateProfile handler.
 */
type ICreateUserDataProcessingHandler = (
  context: Context,
  fiscalCode: FiscalCode,
  userDataProcessingChoiceRequest: UserDataProcessingChoiceRequest
) => Promise<
  // tslint:disable-next-line: max-union-size
  | IResponseSuccessJson<UserDataProcessing>
  | IResponseErrorGeneric
  | IResponseErrorQuery
  | IResponseErrorConflict
>;

export function CreateUserDataProcessingHandler(
  userDataProcessingModel: UserDataProcessingModel
): ICreateUserDataProcessingHandler {
  return async (context, fiscalCode, createUserDataProcessingPayload) => {
    const logPrefix = `CreateUserDataProcessingHandler|FISCAL_CODE=${fiscalCode}`;
    const id = makeUserDataProcessingId(
      createUserDataProcessingPayload.choice,
      fiscalCode
    );
    const userDataProcessing = UserDataProcessing.decode({
      userDataProcessingId: id,
      // tslint:disable-next-line: object-literal-sort-keys
      fiscalCode,
      choice: createUserDataProcessingPayload.choice,
      status: UserDataProcessingStatusEnum.PENDING,
      createdAt: new Date()
    });
    if (isLeft(userDataProcessing)) {
      return ResponseErrorGeneric(
        HttpStatusCodeEnum.HTTP_STATUS_401,
        "Could not complete operation",
        "missing required parameters"
      );
    } else {
      const errorOrCreatedUserDataProcessing = await userDataProcessingModel.createOrUpdateByNewOne(
        userDataProcessing.value
      );

      context.log.error(
        `errorOrCreatedUserDataProcessing ${errorOrCreatedUserDataProcessing}`
      );
      if (isLeft(errorOrCreatedUserDataProcessing)) {
        const { body } = errorOrCreatedUserDataProcessing.value;

        context.log.error(`${logPrefix}|ERROR=${body}`);

        return ResponseErrorQuery(
          "Error while creating a new user data processing",
          errorOrCreatedUserDataProcessing.value
        );
      }

      const createdOrUpdatedUserDataProcessing =
        errorOrCreatedUserDataProcessing.value;
      return ResponseSuccessJson(createdOrUpdatedUserDataProcessing);
    }
  };
}

/**
 * Wraps an CreateProfile handler inside an Express request handler.
 */
export function CreateUserDataProcessing(
  userDataProcessingModel: UserDataProcessingModel
): express.RequestHandler {
  const handler = CreateUserDataProcessingHandler(userDataProcessingModel);

  const middlewaresWrap = withRequestMiddlewares(
    ContextMiddleware(),
    FiscalCodeMiddleware,
    UserDataProcessingChoiceMiddleware
  );
  return wrapRequestHandler(middlewaresWrap(handler));
}