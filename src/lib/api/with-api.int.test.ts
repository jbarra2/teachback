import { afterEach, describe, expect, it } from "vitest";
import * as openapiRoute from "@/app/api/openapi/route";
import { db } from "@/lib/db";
import {
  resetRateLimitOverrides,
  setRateLimitOverrides,
  type RateLimits,
} from "@/lib/rate-limit";
import { LIMITS } from "@/lib/schemas";
import {
  as,
  asAnonymous,
  createUser,
  crossSite,
  fromOrigin,
} from "../../../tests/helpers/api";
import { expectMatchesOpenApi } from "../../../tests/helpers/openapi-assert";
import { withApi } from "./with-api";

// The T07 helpers against the real stack: PostgreSQL (db-test), Better Auth sessions, withApi.
// A protected handler stands in for the routes later tasks add; its error bodies must match the
// shared responses every route documents.
const whoAmI = withApi(({ user }) => Response.json({ email: user?.email }));
const update = withApi(() => Response.json({ ok: true }));

describe("withApi with real sessions (the T07 sample)", () => {
  it("S1: no session → 401, in the contract's shape", async () => {
    const res = await asAnonymous().call(whoAmI, { url: "/api/courses" });
    expect(res.status).toBe(401);
    // The contract allows any error code on any error, so the test names the one it expects.
    expect(await expectMatchesOpenApi(res, "GET /api/courses")).toMatchObject({
      error: { code: "UNAUTHENTICATED" },
    });
  });

  it("signed in → 200 with that user, and each user sees only themselves", async () => {
    const ada = await createUser({ name: "Ada" });
    const grace = await createUser({ name: "Grace" });
    const forAda = await as(ada).call(whoAmI, { url: "/api/courses" });
    const forGrace = await as(grace).call(whoAmI, { url: "/api/courses" });
    expect(forAda.status).toBe(200);
    expect(await forAda.json()).toEqual({ email: ada.email });
    expect(await forGrace.json()).toEqual({ email: grace.email });
  });

  it("S1: a session cookie that was tampered with → 401", async () => {
    const ada = await createUser();
    const tampered = { ...ada, cookie: `${ada.cookie.slice(0, -4)}AAA=` };
    const res = await as(tampered).call(whoAmI, { url: "/api/courses" });
    expect(res.status).toBe(401);
    expect(await expectMatchesOpenApi(res, "GET /api/courses")).toMatchObject({
      error: { code: "UNAUTHENTICATED" },
    });
  });

  const post = { method: "POST", url: "/api/courses", body: { name: "x" } };

  it("S3: a foreign Origin with a valid session → 403, in the contract's shape", async () => {
    const ada = await createUser();
    const res = await as(ada)
      .fromOrigin("https://evil.example")
      .call(update, post);
    expect(res.status).toBe(403);
    expect(await expectMatchesOpenApi(res, "POST /api/courses")).toMatchObject({
      error: { code: "FORBIDDEN_ORIGIN" },
    });
  });

  it("S3: Sec-Fetch-Site: cross-site with a valid session → 403", async () => {
    const ada = await createUser();
    const res = await as(ada).crossSite().call(update, post);
    expect(res.status).toBe(403);
    expect(await expectMatchesOpenApi(res, "POST /api/courses")).toMatchObject({
      error: { code: "FORBIDDEN_ORIGIN" },
    });
  });

  it.each([
    ["a foreign Origin", () => fromOrigin("https://evil.example")],
    ["Sec-Fetch-Site: cross-site", () => crossSite()],
  ])("S3: %s without a session → 403", async (_name, caller) => {
    const res = await caller().call(update, post);
    expect(res.status).toBe(403);
    expect(await expectMatchesOpenApi(res, "POST /api/courses")).toMatchObject({
      error: { code: "FORBIDDEN_ORIGIN" },
    });
  });

  // The callers send Content-Length as a browser does, so an oversized body is refused from the
  // header alone, before the session is even looked up.
  it("S5: an oversized body → 413 before the session check, in the contract's shape", async () => {
    const res = await asAnonymous().call(update, {
      ...post,
      body: { name: "x".repeat(LIMITS.jsonBodyBytes) },
    });
    expect(res.status).toBe(413);
    expect(await expectMatchesOpenApi(res, "POST /api/courses")).toMatchObject({
      error: { code: "PAYLOAD_TOO_LARGE" },
    });
  });

  it("the same POST from the app's own page goes through", async () => {
    const ada = await createUser();
    expect((await as(ada).call(update, post)).status).toBe(200);
  });

  it("S7: a real route's response matches openapi.yaml", async () => {
    const res = await asAnonymous().call(openapiRoute.GET, {
      url: "/api/openapi",
    });
    expect(res.status).toBe(200);
    await expectMatchesOpenApi(res, "GET /api/openapi");
    expect(res.headers.get("x-request-id")).toBeTruthy();
  });
});

// T14: the limiter wired into withApi, against PostgreSQL. Each test sets low limits and its own
// day explicitly (TESTING §3, S6), instead of relying on .env.test's high ones.
describe("withApi rate limits (T14)", () => {
  let day = 0;
  /** Low limits on a fresh UTC day, 12:00:30. */
  function lowLimits(limits: Partial<RateLimits>) {
    day += 1;
    const now = new Date(Date.UTC(2031, 0, day, 12, 0, 30));
    setRateLimitOverrides({ limits, now: () => now });
  }
  afterEach(() => resetRateLimitOverrides());

  let ran = 0;
  const askAi = withApi(
    async ({ json }) => {
      ran += 1;
      await json({ optional: true });
      return Response.json({ ok: true });
    },
    { rateLimit: "ai" },
  );
  const upload = withApi(
    () => {
      ran += 1;
      return Response.json({ ok: true });
    },
    { rateLimit: "upload" },
  );
  const question = {
    method: "POST",
    url: "/api/concepts/cconcept0000000000000001/question",
  };
  const OP = "POST /api/concepts/{id}/question";

  it("S6: past the AI limit → 429 RATE_LIMITED with Retry-After, in the contract's shape, and the handler doesn't run", async () => {
    lowLimits({ aiPerMinute: 2 });
    const ada = await createUser();
    expect((await as(ada).call(askAi, question)).status).toBe(200);
    expect((await as(ada).call(askAi, question)).status).toBe(200);
    ran = 0;
    const res = await as(ada).call(askAi, question);
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("30");
    expect(res.headers.get("x-request-id")).toBeTruthy();
    expect(await expectMatchesOpenApi(res, OP)).toMatchObject({
      error: { code: "RATE_LIMITED" },
    });
    expect(ran).toBe(0);
  });

  it("S6: limits are per user: one user at the limit doesn't stop another", async () => {
    lowLimits({ aiPerMinute: 1 });
    const ada = await createUser();
    const grace = await createUser();
    await as(ada).call(askAi, question);
    expect((await as(ada).call(askAi, question)).status).toBe(429);
    expect((await as(grace).call(askAi, question)).status).toBe(200);
  });

  it("S6: the global daily AI cap applies across users", async () => {
    lowLimits({ aiGlobalPerDay: 2 });
    const users = [await createUser(), await createUser(), await createUser()];
    expect((await as(users[0]).call(askAi, question)).status).toBe(200);
    expect((await as(users[1]).call(askAi, question)).status).toBe(200);
    const res = await as(users[2]).call(askAi, question);
    expect(res.status).toBe(429);
    expect(await expectMatchesOpenApi(res, OP)).toMatchObject({
      error: { code: "RATE_LIMITED" },
    });
  });

  it("S6: the upload limit is counted per hour, on its own", async () => {
    lowLimits({ uploadsPerHour: 1 });
    const ada = await createUser();
    const send = {
      method: "POST",
      url: "/api/documents",
      form: { title: "x" },
    };
    expect((await as(ada).call(upload, send)).status).toBe(200);
    const res = await as(ada).call(upload, send);
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("3570");
    expect(
      await expectMatchesOpenApi(res, "POST /api/documents"),
    ).toMatchObject({ error: { code: "RATE_LIMITED" } });
    // Uploads don't count toward the AI limits.
    expect((await as(ada).call(askAi, question)).status).toBe(200);
  });

  it("S1: no session → 401 before the limiter, and nothing is counted", async () => {
    lowLimits({ aiPerMinute: 1, aiGlobalPerDay: 1 });
    const before = await db.apiRateLimit.count();
    const res = await asAnonymous().call(askAi, question);
    expect(res.status).toBe(401);
    expect(await db.apiRateLimit.count()).toBe(before);
    // The global cap is still untouched for a signed-in user.
    expect((await as(await createUser()).call(askAi, question)).status).toBe(
      200,
    );
  });

  it("S3: a cross-site request is refused before it can count", async () => {
    lowLimits({ aiPerMinute: 1 });
    const ada = await createUser();
    expect((await as(ada).crossSite().call(askAi, question)).status).toBe(403);
    expect((await as(ada).call(askAi, question)).status).toBe(200);
  });

  it("a route without a rateLimit option is never limited", async () => {
    lowLimits({ aiPerMinute: 1, aiGlobalPerDay: 1, uploadsPerHour: 1 });
    const ada = await createUser();
    for (let i = 0; i < 3; i++)
      expect((await as(ada).call(update, question)).status).toBe(200);
  });
});
