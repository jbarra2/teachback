import { describe, expect, it } from "vitest";
import { asAnonymous } from "../../../../tests/helpers/api";
import { expectMatchesOpenApi } from "../../../../tests/helpers/openapi-assert";
import { GET } from "./route";

// The real route against PostgreSQL (db-test). Database-down cases are in route.test.ts and
// src/lib/services/health.test.ts.
describe("GET /api/health (PostgreSQL)", () => {
  it("S7: 200 with the database up, in the contract's shape, without a session", async () => {
    const res = await asAnonymous().call(GET, { url: "/api/health" });
    expect(res.status).toBe(200);
    expect(await expectMatchesOpenApi(res, "GET /api/health")).toEqual({
      status: "ok",
      db: "up",
    });
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toMatch(
      /default-src 'none'/,
    );
  });
});
