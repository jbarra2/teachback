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

// T14: the nonce CSP and security headers on every page response (PLAN §4).
describe("proxy: security headers", () => {
  /** The CSP a response sends, and the one Next reads during rendering to find the nonce. */
  const sentCsp = (response: Response) =>
    response.headers.get("content-security-policy") ?? "";
  const renderCsp = (response: Response) =>
    response.headers.get("x-middleware-request-content-security-policy") ?? "";
  const nonceOf = (csp: string) => /'nonce-([^']+)'/.exec(csp)?.[1];

  const visits: [string, () => Promise<Response>][] = [
    ["the home page", () => visit("/")],
    ["/login, signed out", () => visit("/login")],
    [
      "/login, signed in (redirect)",
      () => {
        readSession.mockResolvedValue(SESSION);
        return visit("/login");
      },
    ],
    ["an app page, signed out (redirect)", () => visit("/courses")],
    [
      "an app page, signed in",
      () => {
        readSession.mockResolvedValue(SESSION);
        return visit("/courses");
      },
    ],
  ];

  it.each(visits)(
    "%s gets a nonce CSP and the security headers",
    async (_name, go) => {
      const response = await go();
      const csp = sentCsp(response);
      expect(csp).toMatch(
        /script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/,
      );
      expect(csp).toMatch(/frame-ancestors 'none'/);
      expect(csp).toMatch(/object-src 'none'/);
      expect(csp).toMatch(/base-uri 'self'/);
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(response.headers.get("referrer-policy")).toBe(
        "strict-origin-when-cross-origin",
      );
      expect(response.headers.get("permissions-policy")).toBeTruthy();
    },
  );

  it.each(visits.filter(([name]) => !name.includes("redirect")))(
    "%s hands Next the same nonce it sends, so Next can tag its scripts",
    async (_name, go) => {
      const response = await go();
      const nonce = nonceOf(sentCsp(response));
      expect(nonce).toBeTruthy();
      expect(renderCsp(response)).toBe(sentCsp(response));
      expect(response.headers.get("x-middleware-request-x-nonce")).toBe(nonce);
    },
  );

  it("uses a new nonce for every request", async () => {
    const nonces = new Set<string | undefined>();
    for (let i = 0; i < 5; i++) nonces.add(nonceOf(sentCsp(await visit("/"))));
    expect(nonces.size).toBe(5);
  });

  it("sends HSTS only in production", async () => {
    expect((await visit("/")).headers.has("strict-transport-security")).toBe(
      false,
    );
    vi.stubEnv("NODE_ENV", "production");
    expect((await visit("/")).headers.get("strict-transport-security")).toMatch(
      /max-age=\d+/,
    );
  });

  it("marks a response that refreshes the session cookie private, so no cache stores it", async () => {
    readSession.mockResolvedValue({
      ...SESSION,
      setCookies: ["better-auth.session_token=new; Path=/; HttpOnly"],
    });
    const response = await visit("/courses");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("a client can't set the nonce Next renders with", async () => {
    const response = await proxy(
      new NextRequest(`${APP}/`, {
        headers: {
          "x-nonce": "attacker",
          "content-security-policy": "script-src * 'unsafe-inline'",
        },
      }),
    );
    expect(response.headers.get("x-middleware-request-x-nonce")).not.toBe(
      "attacker",
    );
    expect(renderCsp(response)).toBe(sentCsp(response));
    expect(renderCsp(response)).not.toContain("script-src *");
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
