import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TEST_APP,
  type MemoryStore,
} from "../../../../../tests/helpers/memory-auth";

// The real route file, with the app's Better Auth config on the in-memory adapter instead of
// PostgreSQL. It proves the route mounts Better Auth through createAuthRoute, not its raw handler.
vi.setConfig({ testTimeout: 30_000 });

const memory = vi.hoisted(() => ({ store: {} as MemoryStore }));
vi.mock("@/lib/auth", async () => {
  const { memoryAuth } =
    await import("../../../../../tests/helpers/memory-auth");
  const { auth, store } = memoryAuth();
  memory.store = store;
  return { auth };
});

const route = await import("./route");
const { auth } = await import("@/lib/auth");

const params = { params: Promise.resolve({ all: [] as string[] }) };
const post = (path: string, body: unknown) =>
  new Request(`${TEST_APP}/api/auth${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: TEST_APP },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  vi.stubEnv("BETTER_AUTH_URL", TEST_APP);
  vi.stubEnv("TRUSTED_IP_HEADER", "");
  vi.stubEnv("BETTER_AUTH_TELEMETRY", "");
  vi.stubEnv("BETTER_AUTH_TRUSTED_ORIGINS", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("src/app/api/auth/[...all]/route.ts", () => {
  it("exports only GET and POST", () => {
    expect(Object.keys(route).sort()).toEqual(["GET", "POST"]);
  });

  it("answers an endpoint the app doesn't use with 404, before Better Auth sees it", async () => {
    const handler = vi.spyOn(auth, "handler");
    const rows = memory.store.rateLimit.length;
    const response = await route.POST(
      post("/update-user", { name: "x" }),
      params,
    );
    expect(response.status).toBe(404);
    expect(handler).not.toHaveBeenCalled();
    expect(memory.store.rateLimit).toHaveLength(rows);
  });

  it("refuses a sign-in with an extra field", async () => {
    const response = await route.POST(
      post("/sign-in/email", {
        email: "a@b.co",
        password: "x",
        callbackURL: "/x",
      }),
      params,
    );
    expect(response.status).toBe(400);
  });

  it("signs up through the checks: the fixed body, and a request id", async () => {
    const response = await route.POST(
      post("/sign-up/email", {
        name: "Ada",
        email: "ada@example.com",
        password: "correct-horse",
      }),
      params,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(response.headers.get("x-request-id")).toBeTruthy();
  });
});
