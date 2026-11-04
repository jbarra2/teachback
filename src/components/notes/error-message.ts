import { ApiError } from "@/lib/api-client";
import { GENERIC_MESSAGE } from "@/lib/api-client/errors";

/** Text that's safe to show: the contract's message, or fixed text for anything else. */
export function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : GENERIC_MESSAGE;
}

/** The server's first message for one field of a 400, else the error's own message. */
export function fieldMessage(error: unknown, field: string): string {
  if (error instanceof ApiError && error.code === "VALIDATION_ERROR")
    return error.details?.fieldErrors[field]?.[0] ?? error.message;
  return errorMessage(error);
}
