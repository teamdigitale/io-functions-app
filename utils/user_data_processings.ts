import { UserDataProcessing } from "io-functions-commons/dist/generated/definitions/UserDataProcessing";
import { RetrievedUserDataProcessing } from "io-functions-commons/dist/src/models/user_data_processing";

/**
 * Converts a UserDataProcessingProfile model to an UserDataProcessing
 */
export function toUserDataProcessingApi(
  userDataProcessing: RetrievedUserDataProcessing
): UserDataProcessing {
  return {
    choice: userDataProcessing.choice,
    created_at: userDataProcessing.createdAt,
    fiscal_code: userDataProcessing.fiscalCode,
    status: userDataProcessing.status,
    updated_at: userDataProcessing.updatedAt,
    version: userDataProcessing.version
  };
}
