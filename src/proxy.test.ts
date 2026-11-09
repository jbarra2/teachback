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
  vi.restoreAllMocks();
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

// T32: `npm run dev` prints http://127.0.0.1:3000 while BETTER_AUTH_URL says localhost, and the
// Origin check then refused every sign-up from 127.0.0.1 with a 403. Outside production, a page
// opened under another name for the server gets a small page that opens the same path on the
// configured origin. Not a Location redirect: Next rewrites a proxy redirect to its own
// "localhost" into a relative one, which sent the browser back to 127.0.0.1 forever (seen live).
// nextUrl doesn't name the host the browser used either, so the Host header is what tells.
describe("proxy: one name for the app outside production", () => {
  const LOCAL = "http://localhost:3000";
  const onHost = (host: string, path: string) =>
    proxy(
      new NextRequest(`http://127.0.0.1:3000${path}`, { headers: { host } }),
    );
  const unescapeHtml = (text: string) =>
    text
      .replaceAll("&quot;", '"')
      .replaceAll("&#39;", "'")
      .replaceAll("&lt;", "<")
      .replaceAll("&gt;", ">")
      .replaceAll("&amp;", "&");

  /** Where the "open it on the configured address" page sends the browser (null: not that page). */
  async function sentTo(response: Response): Promise<string | null> {
    if (response.headers.has("location")) return null;
    if (!response.headers.get("content-type")?.startsWith("text/html"))
      return null;
    const html = await response.clone().text();
    const refresh = /<meta http-equiv="refresh" content="0; url=([^"]*)">/.exec(
      html,
    )?.[1];
    const link = /<a href="([^"]*)">/.exec(html)?.[1];
    if (refresh === undefined || refresh !== link) return null;
    return unescapeHtml(refresh);
  }

  beforeEach(() => {
    // `next dev` runs with NODE_ENV=development; anything else is left alone (see below).
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("BETTER_AUTH_URL", LOCAL);
  });

  it("sends a page opened on 127.0.0.1 to the same path and query on the configured origin", async () => {
    const response = await onHost(
      "127.0.0.1:3000",
      "/courses/c1/practice?concept=c2",
    );
    expect(response.status).toBe(200);
    expect(await sentTo(response)).toBe(
      `${LOCAL}/courses/c1/practice?concept=c2`,
    );
    // Says what's happening, for anyone whose browser doesn't follow it.
    expect(await response.text()).toContain("Opening TeachBack at");
    expect(response.headers.get("cache-control")).toBe("no-store");
    // Before anything else: no session lookup on the wrong name.
    expect(readSession).not.toHaveBeenCalled();
  });

  it.each(["/", "/login", "/signup", "/courses"])(
    "does it for %s too (public, sign-in and app pages alike)",
    async (path) => {
      expect(await sentTo(await onHost("127.0.0.1:3000", path))).toBe(
        `${LOCAL}${path}`,
      );
    },
  );

  it("leaves a request on the configured host alone (no loop)", async () => {
    expect(passesThrough(await onHost("localhost:3000", "/"))).toBe(true);
    const page = await onHost("localhost:3000", "/courses");
    // The usual signed-out redirect, not a second trip to the same page.
    expect(new URL(page.headers.get("location")!).pathname).toBe("/login");
    expect(readSession).toHaveBeenCalledOnce();
  });

  it("compares hosts the way URLs do: case and a default port don't count", async () => {
    expect(passesThrough(await onHost("LOCALHOST:3000", "/"))).toBe(true);
    vi.stubEnv("BETTER_AUTH_URL", "http://localhost");
    expect(passesThrough(await onHost("localhost:80", "/"))).toBe(true);
  });

  it("sends a different port on the same name to the configured one", async () => {
    expect(await sentTo(await onHost("localhost:3001", "/login"))).toBe(
      `${LOCAL}/login`,
    );
  });

  it.each([
    "//evil.example/x",
    "/\\evil.example/x",
    "/%2F%2Fevil.example/x",
    "/%5Cevil.example/x",
    "/https://evil.example/x",
  ])("never sends the browser to another site (path %s)", async (path) => {
    const target = await sentTo(await onHost("127.0.0.1:3000", path));
    expect(new URL(target!).origin).toBe(LOCAL);
    // The same path, kept as a path on this site.
    expect(target).toBe(`${LOCAL}${new URL(`http://h${path}`).pathname}`);
  });

  it("escapes the address it writes into the page", async () => {
    const response = await onHost("127.0.0.1:3000", `/it's"<b>?q='x'&r="<i>"`);
    const html = await response.clone().text();
    // " < and > never reach the page: URL serialisation already percent-encodes them.
    expect(html).not.toMatch(/it's/);
    expect(html).toContain("/it&#39;s");
    expect(html).toContain("&amp;r=");
    // Still the same path and query once the browser reads it back.
    expect(await sentTo(response)).toBe(
      `${LOCAL}${new URL(`http://h/it's"<b>?q='x'&r="<i>"`).pathname}${new URL(`http://h/?q='x'&r="<i>"`).search}`,
    );
  });

  it.each([
    "evil.example",
    "evil.example:3000",
    "localhost:3000@evil.example",
    "[::1]:3000",
    "not a host",
    // Only contains the configured host: not the same thing, so these are sent there too.
    "user@localhost:3000",
    "localhost:3000/x",
    ":pw@localhost:3000",
  ])(
    "takes the target from configuration, never from the Host header (%s)",
    async (host) => {
      expect(await sentTo(await onHost(host, "/login"))).toBe(`${LOCAL}/login`);
    },
  );

  it("does nothing in production, where the host's own routing decides", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("BETTER_AUTH_URL", "https://teachback.example.test");
    expect(passesThrough(await onHost("other.example", "/"))).toBe(true);
  });

  // A staging or preview build behind a proxy that rewrites Host must not answer every page this way.
  it.each(["test", "staging", ""])(
    "does nothing outside `next dev` (NODE_ENV=%j)",
    async (nodeEnv) => {
      vi.stubEnv("NODE_ENV", nodeEnv);
      expect(passesThrough(await onHost("127.0.0.1:3000", "/"))).toBe(true);
    },
  );

  it("does nothing without BETTER_AUTH_URL, or without a Host header", async () => {
    vi.stubEnv("BETTER_AUTH_URL", "");
    expect(passesThrough(await onHost("127.0.0.1:3000", "/"))).toBe(true);
    vi.stubEnv("BETTER_AUTH_URL", LOCAL);
    expect(
      passesThrough(await proxy(new NextRequest("http://127.0.0.1:3000/"))),
    ).toBe(true);
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
  it("logs only the type of a rejection that isn't an Error", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    readSession.mockRejectedValue(
      "connect ECONNREFUSED 127.0.0.1:5433 secret-marker-7f3a",
    );
    const response = await visit("/courses");
    expect(response.status).toBe(503);
    expect(error).toHaveBeenCalledOnce();
    const line = String(error.mock.calls[0]?.[0]);
    expect(line).not.toMatch(/ECONNREFUSED|secret-marker/);
    expect(line).toContain('"errorName":"string"');
  });

  // T32: it used to throw, which showed a blank 500 page while the database was down (seen live).
  it("fails closed on an app page when the session can't be read (database down), with a friendly page", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    readSession.mockRejectedValue(
      new Error("connect ECONNREFUSED 127.0.0.1:5433 secret-marker-7f3a"),
    );
    const response = await visit("/courses");
    // Closed: neither the page nor a redirect that could loop.
    expect(passesThrough(response)).toBe(false);
    expect(response.headers.has("location")).toBe(false);
    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBeTruthy();
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-type")).toMatch(/^text\/html/);
    const html = await response.text();
    expect(html).toContain("TeachBack can't load right now");
    // Readable on a phone, in the app's plain style rather than the browser's default.
    expect(html).toContain('<meta name="viewport"');
    expect(html).toMatch(/<style>[^<]*font-family:/);
    // Nothing from the error reaches the page; the log gets its name only.
    expect(html).not.toMatch(/ECONNREFUSED|5433|secret-marker/);
    expect(error).toHaveBeenCalledOnce();
    expect(String(error.mock.calls[0]?.[0])).not.toMatch(
      /ECONNREFUSED|secret-marker/,
    );
    error.mockRestore();
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
      "an app page while the database is down (unavailable page, redirect-like: no render)",
      () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        readSession.mockRejectedValue(new Error("db down"));
        return visit("/courses");
      },
    ],
    [
      "a page on another name for the server (redirect-like page, next dev)",
      () => {
        vi.stubEnv("NODE_ENV", "development");
        vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
        return proxy(
          new NextRequest("http://127.0.0.1:3000/courses", {
            headers: { host: "127.0.0.1:3000" },
          }),
        );
      },
    ],
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
