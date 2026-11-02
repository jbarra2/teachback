// Every failed API call surfaces as one ApiError (PLAN §7 error shape), so screens handle a single type.
import type { components } from "./schema";

export type ErrorCode = components["schemas"]["ErrorCode"];
export type ValidationDetails = components["schemas"]["ValidationDetails"];

/** The contract's codes, plus NETWORK_ERROR (client only) for a request that never got an answer. */
export type ApiErrorCode = ErrorCode | "NETWORK_ERROR";

// A Record, so tsc fails when openapi.yaml adds or renames a code instead of it silently becoming INTERNAL.
const ERROR_CODES: Record<ErrorCode, true> = {
  VALIDATION_ERROR: true,
  UNSUPPORTED_TYPE: true,
  UNAUTHENTICATED: true,
  FORBIDDEN_ORIGIN: true,
  NOT_FOUND: true,
  PAYLOAD_TOO_LARGE: true,
  UNREADABLE_FILE: true,
  RATE_LIMITED: true,
  INTERNAL: true,
  AI_UNAVAILABLE: true,
};

/** Every contract error code. */
export const ERROR_CODE_LIST = Object.keys(ERROR_CODES) as ErrorCode[];

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
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && Object.hasOwn(ERROR_CODES, value);
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

/**
 * The ApiError for a call that threw instead of answering (offline, DNS, CORS, a malformed success
 * body). The message is fixed; the original error is kept as `cause` for debugging in the browser.
 */
export function networkError(cause?: unknown): ApiError {
  return new ApiError("NETWORK_ERROR", NETWORK_MESSAGE, 0, undefined, {
    cause,
  });
}

/** A request cancelled with an AbortSignal (e.g. on unmount). Not an error to show. */
export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
