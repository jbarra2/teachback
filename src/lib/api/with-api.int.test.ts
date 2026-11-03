import { describe, expect, it } from "vitest";
import * as openapiRoute from "@/app/api/openapi/route";
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
