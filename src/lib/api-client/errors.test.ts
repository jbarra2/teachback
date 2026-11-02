import { describe, expect, it } from "vitest";
import {
  ApiError,
  ERROR_CODE_LIST,
  GENERIC_MESSAGE,
  NETWORK_MESSAGE,
  isAbortError,
  networkError,
  toApiError,
  type ErrorCode,
} from "./errors";

// Each code's status (PLAN §7). A Record, so a code added to openapi.yaml fails tsc here too.
const STATUS: Record<ErrorCode, number> = {
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

const CASES = Object.entries(STATUS) as [ErrorCode, number][];

it("knows exactly the contract's error codes", () => {
  expect([...ERROR_CODE_LIST].sort()).toEqual(Object.keys(STATUS).sort());
});

describe("toApiError", () => {
  it.each(CASES)("keeps %s and its message (status %i)", (code, status) => {
    const error = toApiError(status, {
      error: { code, message: "Shown to the user." },
    });
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({
      name: "ApiError",
      code,
      status,
      message: "Shown to the user.",
    });
  });

  it("keeps validation details", () => {
    const details = { formErrors: [], fieldErrors: { name: ["Too long."] } };
    const error = toApiError(400, {
      error: { code: "VALIDATION_ERROR", message: "Check it.", details },
    });
    expect(error.details).toEqual(details);
  });

  it.each([
    ["an HTML page", "<html>Bad gateway</html>"],
    ["an empty body", undefined],
    ["an empty object", {}],
    ["null", null],
    ["an unknown code", { error: { code: "TEAPOT", message: "I'm a teapot" } }],
    ["a missing message", { error: { code: "NOT_FOUND" } }],
    ["a non-object error", { error: "nope" }],
  ])("turns %s into a generic INTERNAL", (_label, body) => {
    const error = toApiError(502, body);
    expect(error).toMatchObject({
      code: "INTERNAL",
      status: 502,
      message: GENERIC_MESSAGE,
    });
    expect(error.details).toBeUndefined();
  });

  it("never copies raw text into the message", () => {
    expect(toApiError(500, "stack trace at db.ts:12").message).toBe(
      GENERIC_MESSAGE,
    );
  });
});

describe("networkError", () => {
  it("is NETWORK_ERROR with status 0", () => {
    expect(networkError()).toMatchObject({
      code: "NETWORK_ERROR",
      status: 0,
      message: NETWORK_MESSAGE,
    });
  });

  it("keeps the original error as its cause, not in the message", () => {
    const cause = new Error("secret detail");
    const error = networkError(cause);
    expect(error.cause).toBe(cause);
    expect(error.message).toBe(NETWORK_MESSAGE);
  });
});

describe("isAbortError", () => {
  it("recognises an aborted request", () => {
    expect(isAbortError(new DOMException("aborted", "AbortError"))).toBe(true);
  });

  it.each([
    ["another DOMException", new DOMException("x", "NetworkError")],
    ["a TypeError", new TypeError("Failed to fetch")],
    ["a string", "AbortError"],
  ])("ignores %s", (_label, value) => {
    expect(isAbortError(value)).toBe(false);
  });
});
