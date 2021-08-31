import * as t from "io-ts";

import * as express from "express";

import * as E from "fp-ts/lib/Either";
import * as O from "fp-ts/lib/Option";

import { BlobService } from "azure-storage";

import {
  IResponseErrorInternal,
  IResponseSuccessJson,
  ResponseErrorInternal,
  ResponseSuccessJson
} from "@pagopa/ts-commons/lib/responses";

import {
  toServicesTuple,
  VISIBLE_SERVICE_BLOB_ID,
  VISIBLE_SERVICE_CONTAINER,
  VisibleService
} from "@pagopa/io-functions-commons/dist/src/models/visible_service";

import { getBlobAsObject } from "@pagopa/io-functions-commons/dist/src/utils/azure_storage";
import { wrapRequestHandler } from "@pagopa/io-functions-commons/dist/src/utils/request_middleware";

import { PaginatedServiceTupleCollection } from "@pagopa/io-functions-commons/dist/generated/definitions/PaginatedServiceTupleCollection";
import { ServiceScopeEnum } from "@pagopa/io-functions-commons/dist/generated/definitions/ServiceScope";
import { pipe } from "fp-ts/lib/function";

type IGetVisibleServicesHandlerRet =
  | IResponseSuccessJson<PaginatedServiceTupleCollection>
  | IResponseErrorInternal;

type IGetVisibleServicesHandler = () => Promise<IGetVisibleServicesHandlerRet>;

/**
 * Returns all the visible services (is_visible = true).
 */
export function GetVisibleServicesHandler(
  blobService: BlobService,
  onlyNationalService: boolean
): IGetVisibleServicesHandler {
  return async () => {
    const errorOrMaybeVisibleServicesJson = await getBlobAsObject(
      t.record(t.string, VisibleService),
      blobService,
      VISIBLE_SERVICE_CONTAINER,
      VISIBLE_SERVICE_BLOB_ID
    );
    return pipe(
      errorOrMaybeVisibleServicesJson,
      E.foldW(
        error =>
          ResponseErrorInternal(
            `Error getting visible services list: ${error.message}`
          ),
        maybeVisibleServicesJson => {
          const servicesTuples = pipe(
            toServicesTuple(
              new Map<string, VisibleService>(
                pipe(
                  maybeVisibleServicesJson,
                  O.map(Object.entries),
                  O.getOrElse(() => Object.entries({}))
                )
              )
            ),
            arr =>
              onlyNationalService
                ? arr.filter(_ => _.scope === ServiceScopeEnum.NATIONAL)
                : arr
          );
          return ResponseSuccessJson({
            items: servicesTuples,
            page_size: servicesTuples.length
          });
        }
      )
    );
  };
}

/**
 * Wraps a GetVisibleServices handler inside an Express request handler.
 */
export function GetVisibleServices(
  blobService: BlobService,
  onlyNationalService: boolean
): express.RequestHandler {
  const handler = GetVisibleServicesHandler(blobService, onlyNationalService);
  return wrapRequestHandler(handler);
}
