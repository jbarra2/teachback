import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TEST_APP, type MemoryStore } from "../../../tests/helpers/memory-auth";

// withApi's session check against real Better Auth (the app's config on the in-memory adapter)
// and a real session cookie: nothing between withApi and Better Auth is mocked.
vi.setConfig({ testTimeout: 30_000 });

const memory = vi.hoisted(() => ({ store: {} as MemoryStore }));
vi.mock("@/lib/auth", async () => {
  const { memoryAuth } = await import("../../../tests/helpers/memory-auth");
  const { auth, store } = memoryAuth();
  memory.store = store;
  return { auth };
});

const { auth } = await import("@/lib/auth");
const { createAuthRoute } = await import("./auth-route");
const { withApi } = await import("./with-api");

const authRoute = createAuthRoute(auth);
const params = { params: Promise.resolve({}) };
const protectedRoute = withApi(({ user }) => Response.json({ user }));

function post(
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
) {
  return authRoute.POST(
    new Request(`${TEST_APP}/api/auth${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: TEST_APP,
        ...headers,
      },
      body: JSON.stringify(body),
    }),
    params,
  );
}

const visit = (cookie?: string) =>
  protectedRoute(
    new Request(`${TEST_APP}/api/courses`, {
      headers: cookie ? { cookie } : {},
    }),
    params,
  );

let count = 0;
/**
 * A fresh account, signed in: its session cookie. Each comes from its own client IP, so the
 * sign-in limit (3 per 10 s per IP) doesn't make later tests depend on earlier ones.
 */
async function signedIn(): Promise<string> {
  const n = ++count;
  const ip = { "x-real-ip": `203.0.113.${n}` };
  const account = {
    name: "Ada",
    email: `ada${n}@example.com`,
    password: "correct-horse",
  };
  await post("/sign-up/email", account, ip);
  const signIn = await post(
    "/sign-in/email",
    { email: account.email, password: account.password },
    ip,
  );
  const cookie = signIn.headers
    .getSetCookie()
    .find((c) => c.includes("session_token="));
  if (!cookie) throw new Error("no session cookie");
  return cookie.split(";")[0];
}

beforeEach(() => {
  vi.stubEnv("BETTER_AUTH_URL", TEST_APP);
  vi.stubEnv("TRUSTED_IP_HEADER", "x-real-ip");
  vi.stubEnv("BETTER_AUTH_TELEMETRY", "");
  vi.stubEnv("BETTER_AUTH_TRUSTED_ORIGINS", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("withApi with a real Better Auth session", () => {
  it("gives the handler the signed-in user's id, email and name, nothing more", async () => {
    const cookie = await signedIn();
    const response = await visit(cookie);
    expect(response.status).toBe(200);
    const { user } = await response.json();
    expect(Object.keys(user).sort()).toEqual(["email", "id", "name"]);
    expect(user.email).toMatch(/^ada\d+@example\.com$/);
  });

  it("answers 401 without a cookie", async () => {
    expect((await visit()).status).toBe(401);
  });

  it("answers 401 for a cookie whose signature was changed", async () => {
    const cookie = await signedIn();
    const [name, value] = cookie.split("=");
    const decoded = decodeURIComponent(value);
    // One character in the middle of the HMAC, keeping its length and padding, so the check that
    // fails is the signature itself, not the format.
    const [token, signature] = decoded.split(".");
    const i = Math.floor(signature.length / 2);
    const flipped = signature[i] === "A" ? "B" : "A";
    const tampered = `${token}.${signature.slice(0, i)}${flipped}${signature.slice(i + 1)}`;
    expect(tampered).toHaveLength(decoded.length);
    expect(
      (await visit(`${name}=${encodeURIComponent(tampered)}`)).status,
    ).toBe(401);
  });

  it("answers 401 for a session token with another session's signature", async () => {
    const first = decodeURIComponent((await signedIn()).split("=")[1]);
    const second = await signedIn();
    const [name, value] = second.split("=");
    const [token] = decodeURIComponent(value).split(".");
    const [, otherSignature] = first.split(".");
    expect(
      (
        await visit(
          `${name}=${encodeURIComponent(`${token}.${otherSignature}`)}`,
        )
      ).status,
    ).toBe(401);
  });

  // Better Auth extends a session once it's older than updateAge (1 day of its 7) and sets a new
  // cookie. withApi must pass that cookie on, or the session would expire while in use.
  it("passes on the new cookie when Better Auth extends an older session", async () => {
    const cookie = await signedIn();
    const token = decodeURIComponent(cookie.split("=")[1]).split(".")[0];
    const session = memory.store.session.find((row) => row.token === token);
    if (!session) throw new Error("no session row");
    const day = 24 * 60 * 60 * 1000;
    session.expiresAt = new Date(Date.now() + 6 * day - 60_000);
    const response = await visit(cookie);
    expect(response.status).toBe(200);
    const refreshed = response.headers
      .getSetCookie()
      .find((c) => c.includes("session_token="));
    expect(refreshed).toMatch(/Max-Age=604800/);
    expect((session.expiresAt as Date).getTime()).toBeGreaterThan(
      Date.now() + 6 * day,
    );
  });

  it("answers 401 once the user has signed out", async () => {
    const cookie = await signedIn();
    expect((await visit(cookie)).status).toBe(200);
    const signOut = await post("/sign-out", {}, { cookie });
    expect(signOut.status).toBe(200);
    expect((await visit(cookie)).status).toBe(401);
  });
});
