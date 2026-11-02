import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const readSession = vi.fn();
vi.mock("@/lib/api/session", () => ({ readSession }));

const { config, proxy } = await import("./proxy");

const APP = "https://teachback.example.test";
const SESSION = {
  user: { id: "u1", email: "a@b.co", name: "Ada" },
  setCookies: [],
};

const visit = (path: string) => proxy(new NextRequest(`${APP}${path}`));
const passesThrough = (response: Response) =>
  response.headers.get("x-middleware-next") === "1";

beforeEach(() => {
  vi.stubEnv("BETTER_AUTH_URL", APP);
  vi.stubEnv("BETTER_AUTH_TELEMETRY", "");
  vi.stubEnv("BETTER_AUTH_TRUSTED_ORIGINS", "");
  readSession.mockResolvedValue(null);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("proxy: signed-out visitors", () => {
  it("sends an app page to /login, remembering where they were going", async () => {
    const response = await visit("/courses/c1/practice?concept=c2");
    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location")!);
    expect(location.origin + location.pathname).toBe(`${APP}/login`);
    expect(location.searchParams.get("next")).toBe(
      "/courses/c1/practice?concept=c2",
    );
  });

  it("checks the session for real (database), not just that a cookie exists", async () => {
    const request = new NextRequest(`${APP}/courses`, {
      headers: { cookie: "better-auth.session_token=stale.value" },
    });
    readSession.mockResolvedValue(null);
    const response = await proxy(request);
    expect(readSession).toHaveBeenCalledWith(request);
    expect(response.status).toBe(307);
  });

  it("shows /login and /signup, so a stale cookie can't cause a redirect loop", async () => {
    for (const path of ["/login", "/signup"])
      expect(passesThrough(await visit(path))).toBe(true);
  });

  it("shows the home page without looking up a session", async () => {
    expect(passesThrough(await visit("/"))).toBe(true);
    expect(readSession).not.toHaveBeenCalled();
  });

  // Like withApi, the app's origin comes from configuration, not from the request's Host.
  it("redirects to the configured app origin, whatever host the request names", async () => {
    const response = await proxy(
      new NextRequest("https://other.example/courses"),
    );
    expect(new URL(response.headers.get("location")!).origin).toBe(APP);
  });

  it("never puts another site in next", async () => {
    const response = await proxy(new NextRequest(`${APP}//evil.example/x`));
    const location = new URL(response.headers.get("location")!);
    expect(location.origin).toBe(APP);
    expect(location.searchParams.get("next")).toMatch(/^\/(?!\/)/);
  });
});

describe("proxy: signed-in users", () => {
  beforeEach(() => {
    readSession.mockResolvedValue(SESSION);
  });

  it("lets them through to app pages", async () => {
    expect(passesThrough(await visit("/courses"))).toBe(true);
  });

  it("sends them from /login and /signup to /courses", async () => {
    for (const path of ["/login", "/signup"]) {
      const response = await visit(path);
      expect(response.status).toBe(307);
      expect(new URL(response.headers.get("location")!).pathname).toBe(
        "/courses",
      );
    }
  });

  it("passes on the cookie Better Auth sets when it extends the session", async () => {
    readSession.mockResolvedValue({
      ...SESSION,
      setCookies: ["better-auth.session_token=new; Path=/; HttpOnly"],
    });
    const response = await visit("/courses");
    expect(response.headers.getSetCookie()).toContain(
      "better-auth.session_token=new; Path=/; HttpOnly",
    );
  });
});

describe("proxy: failures", () => {
  it("fails closed on an app page when the session can't be read (database down)", async () => {
    readSession.mockRejectedValue(new Error("db down"));
    await expect(visit("/courses")).rejects.toThrow();
  });

  it("still shows /login when the session can't be read", async () => {
    readSession.mockRejectedValue(new Error("db down"));
    expect(passesThrough(await visit("/login"))).toBe(true);
  });

  it("refuses app pages with an unsafe production setup", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("BETTER_AUTH_URL", "http://teachback.example.test");
    readSession.mockResolvedValue(SESSION);
    await expect(visit("/courses")).rejects.toThrow(/BETTER_AUTH_URL/);
  });
});

describe("proxy: which requests it sees (config.matcher)", () => {
  it.each(["/", "/login", "/signup", "/courses", "/courses/c1/map"])(
    "runs on page %s",
    (url) => {
      expect(unstable_doesMiddlewareMatch({ config, url })).toBe(true);
    },
  );

  it.each([
    "/api/courses",
    "/api/auth/get-session",
    "/_next/static/chunks/app.js",
    "/_next/image?url=x",
    "/favicon.ico",
  ])("skips %s", (url) => {
    expect(unstable_doesMiddlewareMatch({ config, url })).toBe(false);
  });
});
