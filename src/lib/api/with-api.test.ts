import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ApiError } from "./errors";
import type { SessionUser } from "./session";
import type { ApiContext } from "./with-api";

const readSession = vi.fn();
vi.mock("./session", () => ({ readSession }));

const logError = vi.fn();
vi.mock("@/lib/log", () => ({
  log: { error: logError, warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const { withApi } = await import("./with-api");

const APP = "https://teachback.example.test";
const USER = { id: "cuser00000000000000000001", email: "a@b.co", name: "Ada" };
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function request(
  method = "GET",
  init: { headers?: Record<string, string>; body?: BodyInit } = {},
) {
  return new Request(`${APP}/api/courses`, { method, ...init });
}

const ok = () => Response.json({ ok: true });
/** A handler spy that records the context withApi passed it. */
const spyHandler = () =>
  vi.fn<
    (
      context: ApiContext<Record<string, string>, SessionUser | null>,
    ) => Response
  >(ok);
/** The context of the handler's first call. */
function contextOf(handler: ReturnType<typeof spyHandler>) {
  const call = handler.mock.calls[0];
  if (!call) throw new Error("the handler wasn't called");
  return call[0];
}
const noParams = { params: Promise.resolve({}) };

beforeEach(() => {
  vi.stubEnv("BETTER_AUTH_URL", APP);
  // A developer's shell may set these; they would make every request a 500.
  vi.stubEnv("BETTER_AUTH_TELEMETRY", "");
  vi.stubEnv("BETTER_AUTH_TRUSTED_ORIGINS", "");
  readSession.mockResolvedValue({ user: USER, setCookies: [] });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("withApi: authentication", () => {
  it("answers 401 UNAUTHENTICATED without a session, and never runs the handler", async () => {
    readSession.mockResolvedValue(null);
    const handler = spyHandler();
    const response = await withApi(handler)(request(), noParams);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: { code: "UNAUTHENTICATED", message: "Please sign in." },
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it("requires a session by default and gives the handler the signed-in user", async () => {
    const handler = spyHandler();
    const req = request("GET", {
      headers: { cookie: "better-auth.session_token=abc" },
    });
    const response = await withApi(handler)(req, noParams);
    expect(response.status).toBe(200);
    expect(readSession).toHaveBeenCalledOnce();
    // This request, cookie and all: not a copy or a new one.
    expect(readSession).toHaveBeenCalledWith(req);
    expect(contextOf(handler).user).toEqual(USER);
  });

  it("skips the session with auth: false, and gives the handler no user", async () => {
    const handler = spyHandler();
    const response = await withApi(handler, { auth: false })(
      request(),
      noParams,
    );
    expect(response.status).toBe(200);
    expect(readSession).not.toHaveBeenCalled();
    expect(contextOf(handler).user).toBeNull();
  });

  it("passes on the cookie Better Auth sets when it extends the session", async () => {
    readSession.mockResolvedValue({
      user: USER,
      setCookies: [
        "better-auth.session_token=new; Path=/; HttpOnly; SameSite=Lax",
      ],
    });
    const response = await withApi(ok)(request(), noParams);
    expect(response.headers.getSetCookie()).toEqual([
      "better-auth.session_token=new; Path=/; HttpOnly; SameSite=Lax",
    ]);
  });
});

describe("withApi: cross-site requests (CSRF)", () => {
  it.each([
    ["a foreign Origin", { origin: "https://evil.example" }],
    ["Sec-Fetch-Site: cross-site", { "sec-fetch-site": "cross-site" }],
  ])(
    "refuses a POST with %s: 403 FORBIDDEN_ORIGIN, before any session lookup",
    async (_name, headers) => {
      const handler = spyHandler();
      const response = await withApi(handler)(
        request("POST", { headers }),
        noParams,
      );
      expect(response.status).toBe(403);
      expect((await response.json()).error.code).toBe("FORBIDDEN_ORIGIN");
      expect(readSession).not.toHaveBeenCalled();
      expect(handler).not.toHaveBeenCalled();
    },
  );

  it("checks routes that don't need a session too", async () => {
    const response = await withApi(ok, { auth: false })(
      request("POST", { headers: { origin: "https://evil.example" } }),
      noParams,
    );
    expect(response.status).toBe(403);
  });

  it("allows a POST from the app's own origin, and one with neither header", async () => {
    for (const headers of [{ origin: APP }, {}] as Record<string, string>[]) {
      const response = await withApi(ok)(
        request("POST", { headers }),
        noParams,
      );
      expect(response.status).toBe(200);
    }
  });

  it("uses BETTER_AUTH_URL as the app's origin, not the request's Host", async () => {
    // A request addressed to another host but carrying that host's Origin is still foreign.
    const response = await withApi(ok)(
      new Request("https://evil.example/api/courses", {
        method: "POST",
        headers: { origin: "https://evil.example" },
      }),
      noParams,
    );
    expect(response.status).toBe(403);
  });
});

describe("withApi: body size", () => {
  it("refuses a Content-Length over 64 KB with 413, before any session lookup", async () => {
    const handler = spyHandler();
    const response = await withApi(handler)(
      request("POST", { headers: { "content-length": String(64 * 1024 + 1) } }),
      noParams,
    );
    expect(response.status).toBe(413);
    expect((await response.json()).error.code).toBe("PAYLOAD_TOO_LARGE");
    expect(readSession).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });

  it("allows exactly 64 KB", async () => {
    const response = await withApi(ok)(
      request("POST", { headers: { "content-length": String(64 * 1024) } }),
      noParams,
    );
    expect(response.status).toBe(200);
  });

  it("takes a route's own limit", async () => {
    const response = await withApi(ok, { maxBodyBytes: 10 })(
      request("POST", { headers: { "content-length": "11" } }),
      noParams,
    );
    expect(response.status).toBe(413);
  });

  it("gives the handler json(), which enforces the limit while reading", async () => {
    const big = JSON.stringify({ text: "x".repeat(100) });
    const handler = withApi(async ({ json }) => Response.json(await json()), {
      maxBodyBytes: 50,
    });
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(big));
        controller.close();
      },
    });
    const response = await handler(
      new Request(`${APP}/api/courses`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: stream,
        duplex: "half",
      } as RequestInit),
      noParams,
    );
    expect(response.status).toBe(413);
  });

  it("parses a JSON body within the limit", async () => {
    const response = await withApi(async ({ json }) =>
      Response.json(await json()),
    )(
      request("POST", {
        headers: { "content-type": "application/json" },
        body: '{"name":"Bio"}',
      }),
      noParams,
    );
    expect(await response.json()).toEqual({ name: "Bio" });
  });
});

describe("withApi: errors", () => {
  it("turns a ZodError into 400 VALIDATION_ERROR with field messages", async () => {
    const schema = z.object({ name: z.string().min(1) }).strict();
    const response = await withApi(() => {
      schema.parse({ name: "", extra: true });
      return ok();
    })(request(), noParams);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.details.fieldErrors.name).toEqual([expect.any(String)]);
    expect(body.error.details.formErrors).toEqual([
      expect.stringMatching(/extra/),
    ]);
  });

  it("answers a known error with its own status and message", async () => {
    const response = await withApi(() => {
      throw new ApiError("NOT_FOUND", "No such course.");
    })(request(), noParams);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: { code: "NOT_FOUND", message: "No such course." },
    });
  });

  it("answers anything else with a generic 500, a request id, and no internals", async () => {
    const response = await withApi(() => {
      throw new TypeError("connect ECONNREFUSED postgres://u:hunter22@db:5432");
    })(request(), noParams);
    expect(response.status).toBe(500);
    const id = response.headers.get("x-request-id");
    expect(id).toMatch(UUID);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({
      error: {
        code: "INTERNAL",
        message: "Something went wrong. Please try again.",
      },
    });
    expect(text).not.toMatch(/hunter22|ECONNREFUSED|TypeError|at /);
  });

  it("logs a 500 with the request id and the error's name, never its message", async () => {
    // A query string can carry tokens, so only the path is logged.
    const response = await withApi(() => {
      throw new TypeError("postgres://u:hunter22@db");
    })(new Request(`${APP}/api/courses?token=secret-q`), noParams);
    expect(JSON.stringify(logError.mock.calls)).not.toContain("secret-q");
    expect(logError).toHaveBeenCalledWith("Request failed", {
      requestId: response.headers.get("x-request-id"),
      method: "GET",
      path: "/api/courses",
      errorName: "TypeError",
    });
    expect(JSON.stringify(logError.mock.calls)).not.toContain("hunter22");
  });

  it("treats a thrown non-Error as a 500 too", async () => {
    const response = await withApi(() => {
      throw "a string";
    })(request(), noParams);
    expect(response.status).toBe(500);
  });

  it("answers 500 when a session lookup fails (database down)", async () => {
    readSession.mockRejectedValue(new Error("db down"));
    const response = await withApi(ok)(request(), noParams);
    expect(response.status).toBe(500);
  });
});

describe("withApi: production settings", () => {
  it("refuses to serve with an unsafe production setup, logging which setting", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("BETTER_AUTH_URL", "http://teachback.example.test");
    vi.stubEnv("TRUSTED_IP_HEADER", "");
    const handler = spyHandler();
    const response = await withApi(handler, { auth: false })(
      request(),
      noParams,
    );
    expect(response.status).toBe(500);
    expect(handler).not.toHaveBeenCalled();
    expect(logError).toHaveBeenCalledWith(
      expect.stringMatching(/BETTER_AUTH_URL[\s\S]*TRUSTED_IP_HEADER/),
      expect.objectContaining({ requestId: expect.stringMatching(UUID) }),
    );
  });
});

describe("withApi: every response is private, never cached", () => {
  const PRIVATE = "private, no-store";

  it("marks a signed-in response private and not to be stored", async () => {
    const response = await withApi(ok)(request(), noParams);
    expect(response.headers.get("cache-control")).toBe(PRIVATE);
  });

  it("marks an error from a signed-in route the same way", async () => {
    readSession.mockResolvedValue(null);
    const unauthenticated = await withApi(ok)(request(), noParams);
    expect(unauthenticated.status).toBe(401);
    expect(unauthenticated.headers.get("cache-control")).toBe(PRIVATE);
    readSession.mockResolvedValue({ user: USER, setCookies: [] });
    const failed = await withApi(() => {
      throw new Error("boom");
    })(request(), noParams);
    expect(failed.status).toBe(500);
    expect(failed.headers.get("cache-control")).toBe(PRIVATE);
  });

  it("overrides a handler that tries to make per-user data cacheable", async () => {
    const response = await withApi(() =>
      Response.json({}, { headers: { "Cache-Control": "public, max-age=60" } }),
    )(request(), noParams);
    expect(response.headers.get("cache-control")).toBe(PRIVATE);
  });

  // Routes without a session check can still answer per user (Better Auth's get-session).
  it("marks a route that needs no session the same way, whatever it sets", async () => {
    const plain = await withApi(ok, { auth: false })(request(), noParams);
    expect(plain.headers.get("cache-control")).toBe(PRIVATE);
    const own = await withApi(
      () => new Response("x", { headers: { "Cache-Control": "max-age=60" } }),
      { auth: false },
    )(request(), noParams);
    expect(own.headers.get("cache-control")).toBe(PRIVATE);
  });
});

describe("withApi: every response", () => {
  it("carries x-request-id, on success too", async () => {
    const response = await withApi(ok)(request(), noParams);
    expect(response.headers.get("x-request-id")).toMatch(UUID);
  });

  it("gives each request its own id", async () => {
    const route = withApi(ok);
    const a = await route(request(), noParams);
    const b = await route(request(), noParams);
    expect(a.headers.get("x-request-id")).not.toBe(
      b.headers.get("x-request-id"),
    );
  });

  it("awaits Next's params and passes them to the handler", async () => {
    const handler = spyHandler();
    await withApi<{ id: string }>(handler)(request(), {
      params: Promise.resolve({ id: "c1" }),
    });
    expect(contextOf(handler).params).toEqual({ id: "c1" });
  });

  it("works with a handler response whose headers can't be changed", async () => {
    const response = await withApi(() => Response.redirect(`${APP}/x`, 302))(
      request(),
      noParams,
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(`${APP}/x`);
    expect(response.headers.get("x-request-id")).toMatch(UUID);
  });

  it("gives the handler empty params when Next passes none", async () => {
    const handler = spyHandler();
    await withApi(handler)(request());
    expect(contextOf(handler).params).toEqual({});
  });

  it("falls back to the request's own origin when BETTER_AUTH_URL is unset (development)", async () => {
    vi.stubEnv("BETTER_AUTH_URL", "");
    const foreign = await withApi(ok)(
      request("POST", { headers: { origin: "https://evil.example" } }),
      noParams,
    );
    const same = await withApi(ok)(
      request("POST", { headers: { origin: APP } }),
      noParams,
    );
    expect(foreign.status).toBe(403);
    expect(same.status).toBe(200);
  });

  // The route coverage test (tests/contract/route-coverage.test.ts) uses the mark to prove every
  // exported route handler went through withApi.
  it("marks its handlers, and only its handlers, as withApi handlers", async () => {
    const { isWithApiHandler } = await import("./with-api");
    expect(isWithApiHandler(withApi(ok))).toBe(true);
    expect(isWithApiHandler(withApi(ok, { auth: false }))).toBe(true);
    expect(isWithApiHandler(async () => ok())).toBe(false);
    expect(isWithApiHandler(undefined)).toBe(false);
    expect(isWithApiHandler({})).toBe(false);
  });

  it("records whether the handler requires a session", async () => {
    const { withApiOptions } = await import("./with-api");
    expect(withApiOptions(withApi(ok))).toEqual({ auth: true });
    expect(withApiOptions(withApi(ok, { auth: false }))).toEqual({
      auth: false,
    });
    expect(withApiOptions(async () => ok())).toBeNull();
    expect(
      withApiOptions(
        Object.assign(() => ok(), { [Symbol.for("teachback.withApi")]: true }),
      ),
    ).toBeNull();
  });

  it("accepts the rateLimit option, which changes nothing until T14 enforces it", async () => {
    const response = await withApi(ok, { rateLimit: "ai" })(
      request(),
      noParams,
    );
    expect(response.status).toBe(200);
  });
});
