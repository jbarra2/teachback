// Shared by the client and mock tests. Not imported by app code.
import { ApiError } from "./errors";

/** The ApiError a call rejects with. Fails the test if it resolves or rejects with anything else. */
export async function rejection(call: Promise<unknown>): Promise<ApiError> {
  const error: unknown = await call.then(
    () => null,
    (reason: unknown) => reason,
  );
  if (!(error instanceof ApiError)) throw new Error("expected an ApiError");
  return error;
}
