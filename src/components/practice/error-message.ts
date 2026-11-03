import { ApiError } from "@/lib/api-client";
import { GENERIC_MESSAGE } from "@/lib/api-client/errors";

export const RATE_LIMITED_MESSAGE =
  "You're going a little fast. Wait a moment, then try again.";
export const AI_UNAVAILABLE_MESSAGE =
  "Feedback isn't available right now. Your answer is still here, so try again in a moment.";

/** What to tell the user. Only fixed text or the contract's message, never a raw error. */
export function errorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return GENERIC_MESSAGE;
  if (error.code === "RATE_LIMITED") return RATE_LIMITED_MESSAGE;
  if (error.code === "AI_UNAVAILABLE") return AI_UNAVAILABLE_MESSAGE;
  return error.message;
}
