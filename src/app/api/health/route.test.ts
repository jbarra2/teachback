import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { expectMatchesOpenApi } from "../../../../tests/helpers/openapi-assert";

const checkHealth = vi.fn();
vi.mock("@/lib/services/health", () => ({ checkHealth }));
const readSession = vi.fn();
vi.mock("@/lib/api/session", () => ({ readSession }));

const { GET } = await import("./route");

const APP = "https://teachback.example.test";
const get = () => GET(new Request(`${APP}/api/health`), {});

beforeEach(() => {
  vi.stubEnv("BETTER_AUTH_URL", APP);
  vi.stubEnv("BETTER_AUTH_TELEMETRY", "");
  vi.stubEnv("BETTER_AUTH_TRUSTED_ORIGINS", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("GET /api/health", () => {
  it("S7: 200 { status: ok, db: up } when the database answers", async () => {
    checkHealth.mockResolvedValue({ status: "ok", db: "up" });
    const res = await get();
    expect(res.status).toBe(200);
    expect(await expectMatchesOpenApi(res, "GET /api/health")).toEqual({
      status: "ok",
      db: "up",
    });
  });

  it("S9: 503 { status: error, db: down } when it doesn't", async () => {
    checkHealth.mockResolvedValue({ status: "error", db: "down" });
    const res = await get();
    expect(res.status).toBe(503);
    expect(await expectMatchesOpenApi(res, "GET /api/health")).toEqual({
      status: "error",
      db: "down",
    });
  });

  it("is public: no session lookup at all", async () => {
    checkHealth.mockResolvedValue({ status: "ok", db: "up" });
    expect((await get()).status).toBe(200);
    expect(readSession).not.toHaveBeenCalled();
  });

  it("S8: reports nothing else: no versions, environment or timings", async () => {
    checkHealth.mockResolvedValue({ status: "ok", db: "up", extra: "leak" });
    const res = await get();
    // X-Powered-By is Next's own, turned off in next.config.ts (tests/tooling/project-config.test.ts).
    expect(Object.keys(await res.json()).sort()).toEqual(["db", "status"]);
  });

  it("is never cached, so a monitor always sees the current state", async () => {
    checkHealth.mockResolvedValue({ status: "ok", db: "up" });
    expect((await get()).headers.get("cache-control")).toBe(
      "private, no-store",
    );
  });
});
