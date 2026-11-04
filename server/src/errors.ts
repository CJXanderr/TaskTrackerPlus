import { RootServerException } from "@rootsdk/server-app";
import { TrackerError } from "@tasktrackerplus/gen-shared";

// Errors that cross to the client. Codes come from the proto TrackerError
// enum so the client can branch on them.

export function fail(code: TrackerError, message: string): never {
  throw new RootServerException(code, message);
}

export const notFound = (what: string): never => fail(TrackerError.NOT_FOUND, `${what} not found`);
export const forbidden = (message = "You don't have permission to do that"): never =>
  fail(TrackerError.FORBIDDEN, message);
export const invalid = (message: string): never => fail(TrackerError.INVALID, message);
export const archived = (): never =>
  fail(TrackerError.ARCHIVED, "This project is archived and read-only");
export const limitReached = (message: string): never => fail(TrackerError.LIMIT_REACHED, message);
export const uploadFailed = (message: string): never => fail(TrackerError.UPLOAD_FAILED, message);
