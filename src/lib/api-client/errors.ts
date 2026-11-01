// Every failed API call surfaces as one ApiError (PLAN §7 error shape), so screens handle a single type.
import type { components } from "./schema";

export type ErrorCode = components["schemas"]["ErrorCode"];
export type ValidationDetails = components["schemas"]["ValidationDetails"];

/** The contract's codes, plus NETWORK_ERROR (client only) for a request that never got an answer. */
export type ApiErrorCode = ErrorCode | "NETWORK_ERROR";

const ERROR_CODES: readonly ErrorCode[] = [
  "VALIDATION_ERROR",
  "UNSUPPORTED_TYPE",
  "UNAUTHENTICATED",
  "FORBIDDEN_ORIGIN",
  "NOT_FOUND",
  "PAYLOAD_TOO_LARGE",
  "UNREADABLE_FILE",
  "RATE_LIMITED",
  "INTERNAL",
  "AI_UNAVAILABLE",
];

export const GENERIC_MESSAGE = "Something went wrong. Please try again.";
export const NETWORK_MESSAGE =
  "Couldn't reach the server. Check your connection and try again.";

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly details?: ValidationDetails;

  constructor(
    code: ApiErrorCode,
    message: string,
    status: number,
    details?: ValidationDetails,
  ) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function isErrorCode(value: unknown): value is ErrorCode {
  return ERROR_CODES.includes(value as ErrorCode);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * The ApiError for a non-2xx response. A body in the contract's shape keeps its code and message
 * (safe to show); anything else (HTML from a proxy, empty, malformed) becomes a generic INTERNAL.
 */
export function toApiError(status: number, body: unknown): ApiError {
  const error = isRecord(body) ? body.error : undefined;
  if (
    isRecord(error) &&
    isErrorCode(error.code) &&
    typeof error.message === "string"
  ) {
    const details = isRecord(error.details)
      ? (error.details as ValidationDetails)
      : undefined;
    return new ApiError(error.code, error.message, status, details);
  }
  return new ApiError("INTERNAL", GENERIC_MESSAGE, status);
}

/** The ApiError for a fetch that threw (offline, DNS, CORS, aborted). The cause is not exposed. */
export function networkError(): ApiError {
  return new ApiError("NETWORK_ERROR", NETWORK_MESSAGE, 0);
}
