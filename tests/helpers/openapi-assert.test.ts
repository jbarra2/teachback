import { describe, expect, it } from "vitest";
import { expectMatchesOpenApi } from "./openapi-assert";

// Hand-built responses against the real openapi.yaml: no database needed.
const json = (body: unknown, status = 200, headers: HeadersInit = {}) =>
  Response.json(body, { status, headers });

const COURSE = {
  id: "ccourse000000000000000001",
  name: "Biology",
  createdAt: "2026-11-02T10:00:00.000Z",
};

describe("expectMatchesOpenApi", () => {
  it("passes a documented status whose body matches, and returns the body", async () => {
    const body = await expectMatchesOpenApi(json([COURSE]), "GET /api/courses");
    expect(body).toEqual([COURSE]);
  });

  it("fails a status the operation doesn't document", async () => {
    await expect(
      expectMatchesOpenApi(json([COURSE], 418), "GET /api/courses"),
    ).rejects.toThrow(/418.*GET \/api\/courses/);
  });

  it("fails a body with a field the schema doesn't allow", async () => {
    await expect(
      expectMatchesOpenApi(
        json([{ ...COURSE, userId: "u1" }]),
        "GET /api/courses",
      ),
    ).rejects.toThrow(/userId|additional/i);
  });

  it("fails a body missing a required field or with a wrong type", async () => {
    const noName = { id: COURSE.id, createdAt: COURSE.createdAt };
    await expect(
      expectMatchesOpenApi(json([noName]), "GET /api/courses"),
    ).rejects.toThrow(/name/);
    await expect(
      expectMatchesOpenApi(
        json([{ ...COURSE, createdAt: "yesterday" }]),
        "GET /api/courses",
      ),
    ).rejects.toThrow(/date-time|format/);
  });

  it("checks error bodies against the shared error schema", async () => {
    const ok = {
      error: { code: "UNAUTHENTICATED", message: "Please sign in." },
    };
    await expectMatchesOpenApi(json(ok, 401), "GET /api/courses");
    await expect(
      expectMatchesOpenApi(
        json({ error: { code: "NOPE", message: "x" } }, 401),
        "GET /api/courses",
      ),
    ).rejects.toThrow(/code|enum/i);
  });

  it("requires the headers the spec marks required", async () => {
    const limited = {
      error: { code: "RATE_LIMITED", message: "Too many requests." },
    };
    await expect(
      expectMatchesOpenApi(
        json(limited, 429),
        "POST /api/questions/{id}/answer",
      ),
    ).rejects.toThrow(/Retry-After/i);
    await expectMatchesOpenApi(
      json(limited, 429, { "retry-after": "10" }),
      "POST /api/questions/{id}/answer",
    );
    const internal = {
      error: {
        code: "INTERNAL",
        message: "Something went wrong. Please try again.",
      },
    };
    await expect(
      expectMatchesOpenApi(json(internal, 500), "GET /api/courses"),
    ).rejects.toThrow(/x-request-id/i);
  });

  it("checks a required header's value too", async () => {
    const limited = {
      error: { code: "RATE_LIMITED", message: "Too many requests." },
    };
    await expect(
      expectMatchesOpenApi(
        json(limited, 429, { "retry-after": "0" }),
        "POST /api/questions/{id}/answer",
      ),
    ).rejects.toThrow(/Retry-After/i);
  });

  it("fails a JSON operation answered with something that isn't JSON", async () => {
    await expect(
      expectMatchesOpenApi(
        new Response("<html>", { status: 200 }),
        "GET /api/courses",
      ),
    ).rejects.toThrow(/content-type/i);
  });

  // A browser treats a body by its Content-Type, so valid JSON labelled text/plain still fails.
  it("fails a valid JSON body sent with another content type", async () => {
    await expect(
      expectMatchesOpenApi(
        new Response(JSON.stringify([COURSE]), {
          status: 200,
          headers: { "content-type": "text/plain" },
        }),
        "GET /api/courses",
      ),
    ).rejects.toThrow(/content-type.*"text\/plain"/);
  });

  // Non-JSON responses are checked too: /api/openapi documents application/yaml.
  it("checks the media type of a response that isn't JSON", async () => {
    const yaml = (type: string) =>
      new Response("openapi: 3.1.0", { headers: { "content-type": type } });
    await expectMatchesOpenApi(
      yaml("application/yaml; charset=utf-8"),
      "GET /api/openapi",
    );
    await expect(
      expectMatchesOpenApi(yaml("text/html"), "GET /api/openapi"),
    ).rejects.toThrow(/application\/yaml/);
  });

  it("refuses an operation the spec doesn't have", async () => {
    await expect(
      expectMatchesOpenApi(json({}), "GET /api/nope"),
    ).rejects.toThrow(/no operation/i);
  });

  it("leaves the response readable afterwards", async () => {
    const response = json([COURSE]);
    await expectMatchesOpenApi(response, "GET /api/courses");
    expect(await response.json()).toEqual([COURSE]);
  });
});
