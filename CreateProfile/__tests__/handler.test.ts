/* tslint:disable: no-any */

import * as lolex from "lolex";

import * as df from "durable-functions";

import { UTCISODateFromString } from "@pagopa/ts-commons/lib/dates";
import { fromLeft, taskEither } from "fp-ts/lib/TaskEither";
import { context as contextMock } from "../../__mocks__/durable-functions";
import {
  aExtendedProfile,
  aFiscalCode,
  aNewProfile,
  aRetrievedProfile
} from "../../__mocks__/mocks";
import { OrchestratorInput as UpsertedProfileOrchestratorInput } from "../../UpsertedProfileOrchestrator/handler";
import { CreateProfileHandler } from "../handler";

// tslint:disable-next-line: no-let
let clock: any;
beforeEach(() => {
  (df.getClient as any).mockClear();
  (df as any).mockStartNew.mockClear();
  clock = lolex.install({ now: Date.now() });
});
afterEach(() => {
  clock = clock.uninstall();
});

const anEmailModeSwitchLimitDate = UTCISODateFromString.decode(
  "2021-07-08T23:59:59Z"
).getOrElseL(() => fail("wrong date value"));

const aTestProfileWithEmailDisabled = {
  ...aRetrievedProfile,
  isEmailEnabled: false
};
describe("CreateProfileHandler", () => {
  it("should return a query error when an error occurs creating the new profile", async () => {
    const profileModelMock = {
      create: jest.fn(() => fromLeft({}))
    };

    const createProfileHandler = CreateProfileHandler(
      profileModelMock as any,
      anEmailModeSwitchLimitDate
    );

    const result = await createProfileHandler(
      contextMock as any,
      undefined as any,
      {} as any
    );

    expect(result.kind).toBe("IResponseErrorQuery");
  });

  it("should return the created profile", async () => {
    const profileModelMock = {
      create: jest.fn(() => taskEither.of(aRetrievedProfile))
    };

    const createProfileHandler = CreateProfileHandler(
      profileModelMock as any,
      anEmailModeSwitchLimitDate
    );

    const result = await createProfileHandler(
      contextMock as any,
      aFiscalCode,
      aNewProfile
    );

    expect(result.kind).toBe("IResponseSuccessJson");
    if (result.kind === "IResponseSuccessJson") {
      expect(result.value).toEqual(aExtendedProfile);
    }
  });

  it("should return the created profile with is_email_enabled set to false", async () => {
    const profileModelMock = {
      create: jest.fn(() => taskEither.of(aTestProfileWithEmailDisabled))
    };

    const createProfileHandler = CreateProfileHandler(
      profileModelMock as any,
      anEmailModeSwitchLimitDate
    );

    const result = await createProfileHandler(
      contextMock as any,
      aFiscalCode,
      aNewProfile
    );

    expect(result.kind).toBe("IResponseSuccessJson");
    if (result.kind === "IResponseSuccessJson") {
      expect(result.value).toEqual({
        ...aExtendedProfile,
        is_email_enabled: false
      });
    }
  });

  it("should start the orchestrator with the appropriate input after the profile has been created", async () => {
    const profileModelMock = {
      create: jest.fn(() => taskEither.of(aRetrievedProfile))
    };
    const createProfileHandler = CreateProfileHandler(
      profileModelMock as any,
      anEmailModeSwitchLimitDate
    );

    await createProfileHandler(contextMock as any, aFiscalCode, {} as any);

    const upsertedProfileOrchestratorInput = UpsertedProfileOrchestratorInput.encode(
      {
        newProfile: aRetrievedProfile,
        updatedAt: new Date()
      }
    );

    expect(df.getClient).toHaveBeenCalledTimes(1);

    const dfClient = df.getClient(contextMock);
    expect(dfClient.startNew).toHaveBeenCalledWith(
      "UpsertedProfileOrchestrator",
      undefined,
      upsertedProfileOrchestratorInput
    );
  });
});
