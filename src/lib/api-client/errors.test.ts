import { describe, expect, it } from "vitest";
import {
  ApiError,
  GENERIC_MESSAGE,
  NETWORK_MESSAGE,
  networkError,
  toApiError,
  type ErrorCode,
} from "./errors";

const CASES: [ErrorCode, number][] = [
  ["VALIDATION_ERROR", 400],
  ["UNSUPPORTED_TYPE", 400],
  ["UNAUTHENTICATED", 401],
  ["FORBIDDEN_ORIGIN", 403],
  ["NOT_FOUND", 404],
  ["PAYLOAD_TOO_LARGE", 413],
  ["UNREADABLE_FILE", 422],
  ["RATE_LIMITED", 429],
  ["INTERNAL", 500],
  ["AI_UNAVAILABLE", 502],
];

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
});
