import { describe, expect, it } from "vitest";
import { z } from "zod";
import { deref, loadSpec } from "../../../tests/helpers/openapi-spec";
import {
  ApiError,
  ERROR_STATUS,
  errorResponse,
  validationError,
} from "./errors";

describe("ApiError", () => {
  it("takes its status from the code (PLAN §7)", () => {
    expect(ERROR_STATUS).toEqual({
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
    });
    expect(new ApiError("NOT_FOUND").status).toBe(404);
  });

  it("is an Error with a fixed default message per code", () => {
    const error = new ApiError("UNAUTHENTICATED");
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("ApiError");
    expect(error.message).toBe("Please sign in.");
    expect(new ApiError("NOT_FOUND", "No such course.").message).toBe(
      "No such course.",
    );
  });
});

describe("default messages (S7)", () => {
  const spec = loadSpec();
  const bodies = Object.values(spec.components.responses ?? {}).flatMap(
    (response) => {
      const media = deref(spec, response).content?.["application/json"];
      const examples = media?.example
        ? [media.example]
        : Object.values(media?.examples ?? {}).map((e) => e.value);
      return examples as { error: { code: string; message: string } }[];
    },
  );

  it("are the spec's example messages, for every code that has a default", async () => {
    let checked = 0;
    for (const { error } of bodies) {
      // Upload rejections with their own sentence are the exception: a service picks those.
      if (
        error.code === "VALIDATION_ERROR" &&
        error.message !== "Some fields are invalid."
      )
        continue;
      const body = await errorResponse(
        new ApiError(error.code as never),
      ).json();
      expect(body.error, error.code).toEqual({
        code: error.code,
        message: error.message,
      });
      checked++;
    }
    expect(checked).toBeGreaterThanOrEqual(10);
  });
});

describe("errorResponse", () => {
  it("returns the contract's error body with the code's status", async () => {
    const response = errorResponse(new ApiError("NOT_FOUND"));
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toMatch(/application\/json/);
    expect(await response.json()).toEqual({
      error: { code: "NOT_FOUND", message: "Not found." },
    });
  });

  it("includes details only when there are some", async () => {
    const details = { formErrors: ["x"], fieldErrors: {} };
    const body = await errorResponse(
      new ApiError("VALIDATION_ERROR", undefined, details),
    ).json();
    expect(body.error.details).toEqual(details);
  });

  it("sets Retry-After on RATE_LIMITED", () => {
    const response = errorResponse(
      new ApiError("RATE_LIMITED", undefined, undefined, { retryAfter: 7 }),
    );
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("7");
  });

  it("adds the headers it's given", () => {
    const response = errorResponse(new ApiError("INTERNAL"), {
      "x-request-id": "abc",
    });
    expect(response.headers.get("x-request-id")).toBe("abc");
  });
});

describe("validationError", () => {
  it("turns a ZodError into VALIDATION_ERROR with exactly z.flattenError's details", () => {
    const result = z
      .object({ name: z.string().min(2) })
      .strict()
      .safeParse({ name: "a", extra: 1 });
    if (result.success) throw new Error("expected a failure");
    const error = validationError(result.error);
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.status).toBe(400);
    expect(error.details).toEqual(z.flattenError(result.error));
    expect(Object.keys(error.details as object).sort()).toEqual([
      "fieldErrors",
      "formErrors",
    ]);
  });
});
