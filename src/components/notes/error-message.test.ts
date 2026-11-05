import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api-client";
import { GENERIC_MESSAGE } from "@/lib/api-client/errors";
import { errorMessage, fieldMessage } from "./error-message";

const invalid = (fieldErrors: Record<string, string[]>) =>
  new ApiError("VALIDATION_ERROR", "Some fields are invalid.", 400, {
    formErrors: [],
    fieldErrors,
  });

describe("errorMessage", () => {
  it("shows an ApiError's message and hides anything else", () => {
    expect(errorMessage(new ApiError("NOT_FOUND", "Not found.", 404))).toBe(
      "Not found.",
    );
    expect(errorMessage(new Error("db password=hunter2"))).toBe(
      GENERIC_MESSAGE,
    );
  });
});

describe("fieldMessage", () => {
  it("picks the field's first error from a 400", () => {
    expect(fieldMessage(invalid({ name: ["Too long.", "Bad."] }), "name")).toBe(
      "Too long.",
    );
  });

  it("falls back to the 400's message when the field has none", () => {
    expect(fieldMessage(invalid({ other: ["x"] }), "name")).toBe(
      "Some fields are invalid.",
    );
  });

  it("uses the error's own message for anything but a 400", () => {
    expect(
      fieldMessage(new ApiError("RATE_LIMITED", "Slow down.", 429), "name"),
    ).toBe("Slow down.");
    expect(fieldMessage(new Error("raw"), "name")).toBe(GENERIC_MESSAGE);
  });
});
