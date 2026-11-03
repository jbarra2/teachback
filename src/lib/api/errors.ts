// The contract's errors (PLAN §7, openapi.yaml): `{ error: { code, message, details? } }`. Messages
// are fixed sentences or ones a service chose for the user, never an exception's own text.
import { z } from "zod";
import type { components } from "@/lib/api-client/schema";

export type ErrorCode = components["schemas"]["ErrorCode"];

// A Record, so tsc fails when openapi.yaml adds or renames a code.
export const ERROR_STATUS: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNSUPPORTED_TYPE: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN_ORIGIN: 403,
  NOT_FOUND: 404,
  PAYLOAD_TOO_LARGE: 413,
  UNREADABLE_FILE: 422,
  RATE_LIMITED: 429,
  INTERNAL: 500,
  AI_UNAVAILABLE: 502,
};

// The spec's example message for each code (components.responses in openapi.yaml).
const DEFAULT_MESSAGE: Record<ErrorCode, string> = {
  VALIDATION_ERROR: "Some fields are invalid.",
  UNSUPPORTED_TYPE: "Upload a .txt, .md or text-based .pdf file.",
  UNAUTHENTICATED: "Please sign in.",
  FORBIDDEN_ORIGIN: "This request isn't allowed from another site.",
  NOT_FOUND: "Not found.",
  PAYLOAD_TOO_LARGE: "That's too large.",
  UNREADABLE_FILE: "We couldn't read any text in that file.",
  RATE_LIMITED: "Too many requests. Please wait a moment.",
  INTERNAL: "Something went wrong. Please try again.",
  AI_UNAVAILABLE: "The AI service is unavailable right now.",
};

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;
  /** Seconds, for RATE_LIMITED. */
  readonly retryAfter?: number;

  constructor(
    code: ErrorCode,
    message: string = DEFAULT_MESSAGE[code],
    details?: unknown,
    options: { retryAfter?: number } = {},
  ) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = ERROR_STATUS[code];
    this.details = details;
    this.retryAfter = options.retryAfter;
  }
}

/** 400 VALIDATION_ERROR whose details are exactly `z.flattenError` (ValidationDetails in the spec). */
export function validationError(error: z.ZodError): ApiError {
  return new ApiError("VALIDATION_ERROR", undefined, z.flattenError(error));
}

export function errorResponse(
  error: ApiError,
  headers?: HeadersInit,
): Response {
  const response = Response.json(
    {
      error: {
        code: error.code,
        message: error.message,
        ...(error.details === undefined ? {} : { details: error.details }),
      },
    },
    { status: error.status, headers },
  );
  if (error.retryAfter !== undefined)
    response.headers.set("retry-after", String(error.retryAfter));
  return response;
}
