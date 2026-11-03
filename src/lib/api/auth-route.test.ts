import { memoryAdapter } from "better-auth/adapters/memory";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAuth } from "@/lib/auth-config";
import { createAuthRoute } from "./auth-route";

// The real Better Auth config (src/lib/auth.ts) on Better Auth's in-memory adapter, behind the real
// route and withApi. T07 repeats the flows against PostgreSQL. A cold import of Better Auth can pass
// Vitest's 5 s default on a busy machine.
vi.setConfig({ testTimeout: 30_000 });

const APP = "https://teachback.example.test";
const SECRET = "a-random-test-secret-that-is-long-enough-0123";
const ADA = {
  name: "Ada Lovelace",
  email: "ada@example.com",
  password: "correct-horse",
};

type Store = Record<string, Record<string, unknown>[]>;
let store: Store;

function setup(env: Record<string, string> = {}) {
  store = {
    user: [],
    session: [],
    account: [],
    verification: [],
    rateLimit: [],
  };
  const auth = createAuth(memoryAdapter(store), {
    BETTER_AUTH_SECRET: SECRET,
    BETTER_AUTH_URL: APP,
    ...env,
  });
  const handler = vi.spyOn(auth, "handler");
  return { route: createAuthRoute(auth), handler, auth };
}

const params = { params: Promise.resolve({ all: [] as string[] }) };

function post(
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Request {
  return new Request(`${APP}/api/auth${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: APP, ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function get(path: string, headers: Record<string, string> = {}): Request {
  return new Request(`${APP}/api/auth${path}`, { headers });
}

/** The session cookie from a response, as a Cookie header value. */
function cookieFrom(response: Response): string {
  const cookie = response.headers
    .getSetCookie()
    .find((c) => c.includes("session_token="));
  if (!cookie) throw new Error("no session cookie set");
  return cookie.split(";")[0];
}

/** Every key anywhere in a JSON value. */
function keysOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keysOf);
  if (value && typeof value === "object")
    return Object.entries(value).flatMap(([k, v]) => [k, ...keysOf(v)]);
  return [];
}

async function signUpAndIn(route: ReturnType<typeof createAuthRoute>) {
  await route.POST(post("/sign-up/email", ADA), params);
  const signIn = await route.POST(
    post("/sign-in/email", { email: ADA.email, password: ADA.password }),
    params,
  );
  return { signIn, cookie: cookieFrom(signIn) };
}

beforeEach(() => {
  vi.stubEnv("BETTER_AUTH_URL", APP);
  // A developer's shell may set these; each test that needs one sets it itself.
  vi.stubEnv("TRUSTED_IP_HEADER", "");
  vi.stubEnv("BETTER_AUTH_TELEMETRY", "");
  vi.stubEnv("BETTER_AUTH_TRUSTED_ORIGINS", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("auth route: sign up, sign in, read the session, sign out", () => {
  it("works end to end through the handler", async () => {
    const { route } = setup();

    const signUp = await route.POST(post("/sign-up/email", ADA), params);
    expect(signUp.status).toBe(200);
    // autoSignIn: false. Sign-up signs no one in; the form signs in next (T15).
    expect(signUp.headers.getSetCookie().join()).not.toContain(
      "session_token=",
    );

    const { signIn, cookie } = await signUpAndIn(route);
    expect(signIn.status).toBe(200);
    expect((await signIn.json()).user).toMatchObject({
      email: ADA.email,
      name: ADA.name,
    });

    const session = await route.GET(get("/get-session", { cookie }), params);
    expect(session.status).toBe(200);
    expect((await session.json()).user.email).toBe(ADA.email);

    const signOut = await route.POST(post("/sign-out", {}, { cookie }), params);
    expect(signOut.status).toBe(200);
    expect(signOut.headers.getSetCookie().join()).toMatch(
      /session_token=;.*Max-Age=0/i,
    );

    const after = await route.GET(get("/get-session", { cookie }), params);
    expect(await after.json()).toBeNull();
  });

  it("answers sign-up the same way for an existing email as for a new one", async () => {
    const { route } = setup();
    const first = await route.POST(post("/sign-up/email", ADA), params);
    const again = await route.POST(
      post("/sign-up/email", { ...ADA, password: "another-password" }),
      params,
    );
    expect(again.status).toBe(first.status);
    // Byte for byte: Better Auth's stand-in user for an existing email has an extra `image: null`
    // and its fields in another order, which would give the account away.
    const [firstText, againText] = [await first.text(), await again.text()];
    expect(againText).toBe(firstText);
    expect(JSON.parse(firstText)).toEqual({ success: true });
    expect(again.headers.getSetCookie()).toEqual(first.headers.getSetCookie());
    // And the existing account still has its own password.
    const signIn = await route.POST(
      post("/sign-in/email", { email: ADA.email, password: ADA.password }),
      params,
    );
    expect(signIn.status).toBe(200);
  });

  it("refuses a wrong password and an unknown email alike", async () => {
    const { route } = setup();
    await route.POST(post("/sign-up/email", ADA), params);
    const wrong = await route.POST(
      post("/sign-in/email", { email: ADA.email, password: "wrong-password" }),
      params,
    );
    const unknown = await route.POST(
      post("/sign-in/email", {
        email: "nobody@example.com",
        password: "wrong-password",
      }),
      params,
    );
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(await wrong.json()).toEqual(await unknown.json());
  });

  it("sets an httpOnly, SameSite=Lax, Secure __Secure- cookie for an https app", async () => {
    const { route } = setup();
    const { signIn } = await signUpAndIn(route);
    const cookie = signIn.headers
      .getSetCookie()
      .find((c) => c.includes("session_token="))!;
    expect(cookie).toMatch(/^__Secure-better-auth\.session_token=/);
    expect(cookie).toMatch(/; HttpOnly/i);
    expect(cookie).toMatch(/; SameSite=Lax/i);
    expect(cookie).toMatch(/; Secure/i);
    expect(cookie).toMatch(/; Path=\//i);
  });
});

describe("auth route: S8, no tokens or secrets in responses", () => {
  it("strips the session token from the sign-in and get-session bodies", async () => {
    const { route } = setup();
    const { signIn, cookie } = await signUpAndIn(route);
    const token = decodeURIComponent(cookie.split("=")[1]).split(".")[0];
    const session = await route.GET(get("/get-session", { cookie }), params);
    for (const response of [signIn, session]) {
      const text = await response.text();
      expect(keysOf(JSON.parse(text))).not.toContain("token");
      expect(text).not.toContain(token);
      expect(text).not.toMatch(/password|hash/i);
    }
  });

  it("never returns the password hash or the account row on sign-up", async () => {
    const { route } = setup();
    const text = await (
      await route.POST(post("/sign-up/email", ADA), params)
    ).text();
    expect(text).not.toMatch(/password|hash|account/i);
    expect(text).not.toContain(ADA.password);
  });
});

describe("auth route: only the endpoints the app uses (default deny)", () => {
  it.each([
    ["POST", "/update-user"],
    ["POST", "/delete-user"],
    ["POST", "/change-password"],
    ["POST", "/change-email"],
    ["POST", "/verify-password"],
    ["POST", "/request-password-reset"],
    ["POST", "/reset-password"],
    ["POST", "/sign-in/social"],
    ["POST", "/revoke-sessions"],
    ["GET", "/list-sessions"],
    ["GET", "/list-accounts"],
    ["GET", "/ok"],
    ["GET", "/error"],
    ["GET", "/verify-email"],
    ["POST", "/get-session"],
    ["GET", "/sign-in/email"],
    ["POST", "/sign-in/email/"],
    ["POST", "/SIGN-IN/EMAIL"],
    ["POST", "/no-such-endpoint"],
    ["GET", ""],
  ])(
    "answers %s %s with 404 before Better Auth or the database see it",
    async (method, path) => {
      const { route, handler } = setup();
      const request =
        method === "GET"
          ? get(path)
          : post(path, {}, { "content-type": "application/json" });
      const response = await (method === "GET" ? route.GET : route.POST)(
        request,
        params,
      );
      expect(response.status).toBe(404);
      expect((await response.json()).error.code).toBe("NOT_FOUND");
      expect(handler).not.toHaveBeenCalled();
      expect(store.rateLimit).toEqual([]);
    },
  );

  it("drops the query string, so options like callbackURL never reach Better Auth", async () => {
    const { route, handler } = setup();
    await route.GET(
      get("/get-session?disableRefresh=true&callbackURL=https://evil.example"),
      params,
    );
    expect(new URL(handler.mock.calls[0][0].url).search).toBe("");
  });

  it("refuses a path outside /api/auth/, even one the same length", async () => {
    const { route, handler } = setup();
    const response = await route.GET(
      new Request(`${APP}/api/autX/get-session`),
      params,
    );
    expect(response.status).toBe(404);
    expect(handler).not.toHaveBeenCalled();
  });
});

describe("auth route: S3, cross-site requests", () => {
  it.each([
    ["a foreign Origin", { origin: "https://evil.example" }],
    ["Sec-Fetch-Site: cross-site", { "sec-fetch-site": "cross-site" }],
  ])(
    "refuses sign-in with %s (403 FORBIDDEN_ORIGIN)",
    async (_name, headers) => {
      const { route, handler } = setup();
      const response = await route.POST(
        post(
          "/sign-in/email",
          { email: ADA.email, password: ADA.password },
          headers,
        ),
        params,
      );
      expect(response.status).toBe(403);
      expect((await response.json()).error.code).toBe("FORBIDDEN_ORIGIN");
      expect(handler).not.toHaveBeenCalled();
    },
  );

  it("refuses sign-out with a foreign Origin, so another site can't sign the user out", async () => {
    const { route, handler } = setup();
    const { cookie } = await signUpAndIn(route);
    const calls = handler.mock.calls.length;
    const response = await route.POST(
      post("/sign-out", {}, { cookie, origin: "https://evil.example" }),
      params,
    );
    expect(response.status).toBe(403);
    // Refused by the app's own check, before Better Auth (which would also say 403).
    expect(handler.mock.calls.length).toBe(calls);
    const session = await route.GET(get("/get-session", { cookie }), params);
    expect(await session.json()).not.toBeNull();
  });
});

describe("auth route: S4, strict bodies", () => {
  it.each([
    [
      "an image, which Better Auth would store unchecked",
      { ...ADA, image: "x".repeat(5000) },
    ],
    ["a callbackURL", { ...ADA, callbackURL: "https://evil.example" }],
    ["emailVerified", { ...ADA, emailVerified: true }],
    ["a 101-character name", { ...ADA, name: "a".repeat(101) }],
    ["a 7-character password", { ...ADA, password: "1234567" }],
    ["a bad email", { ...ADA, email: "nope" }],
    ["a missing name", { email: ADA.email, password: ADA.password }],
  ])("refuses a sign-up with %s: 400, nothing stored", async (_name, body) => {
    const { route, handler } = setup();
    const response = await route.POST(post("/sign-up/email", body), params);
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.error.code).toBe("VALIDATION_ERROR");
    expect(json.error.details).toHaveProperty("fieldErrors");
    expect(handler).not.toHaveBeenCalled();
    expect(store.user).toEqual([]);
  });

  it("stores the trimmed name and lowercased email it checked", async () => {
    const { route } = setup();
    await route.POST(
      post("/sign-up/email", {
        ...ADA,
        name: "  Ada  ",
        email: " ADA@Example.com ",
      }),
      params,
    );
    expect(store.user).toEqual([
      expect.objectContaining({ name: "Ada", email: "ada@example.com" }),
    ]);
  });

  it.each([
    [
      "form encoding",
      "application/x-www-form-urlencoded",
      "email=a%40b.co&password=x",
    ],
    [
      "text/plain",
      "text/plain",
      JSON.stringify({ email: "a@b.co", password: "x" }),
    ],
    ["malformed JSON", "application/json", "{email:"],
  ])("refuses a sign-in sent as %s", async (_name, type, body) => {
    const { route, handler } = setup();
    const response = await route.POST(
      post("/sign-in/email", body, { "content-type": type }),
      params,
    );
    expect(response.status).toBe(400);
    expect(handler).not.toHaveBeenCalled();
  });

  it("refuses a sign-in with extra fields", async () => {
    const { route } = setup();
    const response = await route.POST(
      post("/sign-in/email", {
        email: ADA.email,
        password: "x",
        callbackURL: "/x",
      }),
      params,
    );
    expect(response.status).toBe(400);
  });

  // Next hands a route handler a body stream for every POST, even one sent with no body, so a bare
  // sign-out arrives as an empty stream, not as `body: null`.
  const emptyStream = () =>
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.close();
      },
    });

  it.each([
    ["no body at all", () => ({})],
    [
      "an empty body stream, as Next passes it",
      () => ({ body: emptyStream(), duplex: "half" }),
    ],
    [
      "an empty object",
      () => ({ body: "{}", headers: { "content-type": "application/json" } }),
    ],
  ])("signs out with %s", async (_name, init) => {
    const { route } = setup();
    const { cookie } = await signUpAndIn(route);
    const { headers = {}, ...rest } = init() as RequestInit & {
      headers?: Record<string, string>;
    };
    const response = await route.POST(
      new Request(`${APP}/api/auth/sign-out`, {
        method: "POST",
        headers: { origin: APP, cookie, ...headers },
        ...rest,
      } as RequestInit),
      params,
    );
    expect(response.status).toBe(200);
    const session = await route.GET(get("/get-session", { cookie }), params);
    expect(await session.json()).toBeNull();
  });

  it.each([
    ["a callbackURL", { callbackURL: "https://evil.example" }],
    ["any field", { all: true }],
  ])("refuses sign-out with %s", async (_name, body) => {
    const { route } = setup();
    const { cookie } = await signUpAndIn(route);
    const response = await route.POST(
      post("/sign-out", body, { cookie }),
      params,
    );
    expect(response.status).toBe(400);
  });

  it("refuses a non-empty sign-out body that isn't JSON", async () => {
    const { route } = setup();
    const { cookie } = await signUpAndIn(route);
    const response = await route.POST(
      post("/sign-out", "x", { cookie, "content-type": "text/plain" }),
      params,
    );
    expect(response.status).toBe(400);
  });
});

describe("auth route: S5, body size", () => {
  it("refuses a body over 8 KB with 413 before Better Auth sees it", async () => {
    const { route, handler } = setup();
    const response = await route.POST(
      post("/sign-up/email", { ...ADA, name: "a".repeat(9000) }),
      params,
    );
    expect(response.status).toBe(413);
    expect(handler).not.toHaveBeenCalled();
  });
});

describe("auth route: S6, rate limits and the client's IP", () => {
  const attempt = (route: ReturnType<typeof createAuthRoute>, headers = {}) =>
    route.POST(
      post(
        "/sign-in/email",
        { email: ADA.email, password: "wrong-password" },
        headers,
      ),
      params,
    );

  it("limits sign-in to 3 tries per 10 s, answering 429 with Retry-After", async () => {
    const { route } = setup();
    for (let i = 0; i < 3; i++) expect((await attempt(route)).status).toBe(401);
    const limited = await attempt(route);
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("ignores X-Forwarded-For and our own IP header from the client", async () => {
    const { route } = setup();
    for (let i = 0; i < 3; i++)
      await attempt(route, {
        "x-forwarded-for": `203.0.113.${i}`,
        "x-teachback-client-ip": `198.51.100.${i}`,
      });
    const limited = await attempt(route, {
      "x-forwarded-for": "203.0.113.99",
      "x-teachback-client-ip": "198.51.100.99",
    });
    expect(limited.status).toBe(429);
  });

  it("counts per client IP from TRUSTED_IP_HEADER when the host sets one", async () => {
    vi.stubEnv("TRUSTED_IP_HEADER", "x-real-ip");
    const { route } = setup();
    for (let i = 0; i < 3; i++)
      await attempt(route, { "x-real-ip": "203.0.113.1" });
    expect((await attempt(route, { "x-real-ip": "203.0.113.1" })).status).toBe(
      429,
    );
    expect((await attempt(route, { "x-real-ip": "203.0.113.2" })).status).toBe(
      401,
    );
  });

  it("uses the last address in a list, the one the host's proxy added", async () => {
    vi.stubEnv("TRUSTED_IP_HEADER", "x-forwarded-for");
    const { route } = setup();
    for (let i = 0; i < 3; i++)
      await attempt(route, {
        "x-forwarded-for": `198.51.100.${i}, 203.0.113.1`,
      });
    const limited = await attempt(route, {
      "x-forwarded-for": "198.51.100.77, 203.0.113.1",
    });
    expect(limited.status).toBe(429);
    // A different last entry is a different client, so the list really was split and trimmed
    // (with no IP at all, every request would share one bucket and this would be 429 too).
    const other = await attempt(route, {
      "x-forwarded-for": "198.51.100.77, 203.0.113.2",
    });
    expect(other.status).toBe(401);
  });

  it("passes Better Auth the trimmed last entry", async () => {
    vi.stubEnv("TRUSTED_IP_HEADER", "x-forwarded-for");
    const { route, handler } = setup();
    await attempt(route, {
      "x-forwarded-for": "198.51.100.1 ,  203.0.113.1  ",
    });
    expect(handler.mock.calls[0][0].headers.get("x-teachback-client-ip")).toBe(
      "203.0.113.1",
    );
  });

  it("ignores a trusted header that isn't an IP address", async () => {
    vi.stubEnv("TRUSTED_IP_HEADER", "x-real-ip");
    const { route, handler } = setup();
    await attempt(route, { "x-real-ip": "not-an-ip" });
    expect(
      handler.mock.calls[0][0].headers.get("x-teachback-client-ip"),
    ).toBeNull();
  });

  describe("in production", () => {
    beforeEach(() => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("TRUSTED_IP_HEADER", "x-real-ip");
      // A real-looking secret: production refuses .env.test's public one, whatever the shell has.
      vi.stubEnv(
        "BETTER_AUTH_SECRET",
        "a-production-like-secret-that-is-long-enough",
      );
      // Vitest sets TEST, which production refuses (Better Auth reads it as a test run).
      vi.stubEnv("TEST", undefined);
    });

    // Without an IP, Better Auth would put every client in one sign-in bucket, so one client
    // could keep everyone else out.
    it("refuses a request with no client IP instead of sharing one rate-limit bucket", async () => {
      const printed: string[] = [];
      vi.spyOn(console, "error").mockImplementation((line) => {
        printed.push(String(line));
      });
      const { route, handler } = setup();
      const response = await attempt(route);
      expect(response.status).toBe(500);
      expect(handler).not.toHaveBeenCalled();
      // Logged by name, so an operator sees what's wrong with the proxy setup.
      expect(printed.map((line) => JSON.parse(line).errorName)).toContain(
        "ClientIpMissing",
      );
    });

    it("serves a request whose trusted header holds an IP", async () => {
      const { route, handler } = setup();
      const response = await attempt(route, { "x-real-ip": "203.0.113.9" });
      expect(response.status).toBe(401);
      expect(handler).toHaveBeenCalledOnce();
    });
  });

  it("sets no client IP when the trusted header is missing", async () => {
    vi.stubEnv("TRUSTED_IP_HEADER", "x-real-ip");
    const { route, handler } = setup();
    await attempt(route, { "x-teachback-client-ip": "198.51.100.7" });
    expect(
      handler.mock.calls[0][0].headers.get("x-teachback-client-ip"),
    ).toBeNull();
  });
});

describe("auth route: responses it doesn't rewrite", () => {
  it("passes a non-JSON response through as it is", async () => {
    const { route, handler } = setup();
    handler.mockResolvedValue(
      new Response("plain", {
        status: 418,
        headers: { "content-type": "text/plain" },
      }),
    );
    const response = await route.GET(get("/get-session"), params);
    expect(response.status).toBe(418);
    expect(await response.text()).toBe("plain");
  });
});

describe("auth route: tokens in any response shape", () => {
  it("drops every key ending in token, at any depth and in any case", async () => {
    const { route, handler } = setup();
    handler.mockResolvedValue(
      Response.json({
        user: { id: "u1" },
        session: {
          accessToken: "secret-a",
          list: [{ IdToken: "secret-b", refreshTOKEN: "secret-c" }],
        },
      }),
    );
    const text = await (await route.GET(get("/get-session"), params)).text();
    expect(text).not.toMatch(/secret-|token/i);
    expect(JSON.parse(text)).toEqual({
      user: { id: "u1" },
      session: { list: [{}] },
    });
  });
});

describe("auth route: S9, failures", () => {
  it("answers a crash inside Better Auth with a generic 500 and a request id", async () => {
    const { route, handler } = setup();
    handler.mockRejectedValue(
      new Error("connect ECONNREFUSED ada@example.com"),
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await route.POST(
      post("/sign-in/email", { email: ADA.email, password: "x" }),
      params,
    );
    expect(response.status).toBe(500);
    expect(response.headers.get("x-request-id")).toBeTruthy();
    expect(await response.text()).not.toMatch(/ECONNREFUSED|example\.com/);
  });

  // A database error before the insert: with onAPIError.throw, it reaches withApi (a generic 500
  // with a request id) instead of better-call printing the whole error.
  it("answers a database error during sign-in with a generic 500, printing nothing of it", async () => {
    const { route, auth } = setup();
    const { internalAdapter } = await auth.$context;
    vi.spyOn(internalAdapter, "findUserByEmail").mockRejectedValue(
      new Error("connect ECONNREFUSED postgres://u:hunter22@db"),
    );
    const printed: unknown[] = [];
    for (const method of ["log", "warn", "error", "info", "debug"] as const)
      vi.spyOn(console, method).mockImplementation((...args) => {
        printed.push(...args);
      });
    const response = await route.POST(
      post("/sign-in/email", { email: ADA.email, password: ADA.password }),
      params,
    );
    expect(response.status).toBe(500);
    expect(response.headers.get("x-request-id")).toBeTruthy();
    expect(await response.text()).not.toMatch(/hunter22|ECONNREFUSED/);
    const output = JSON.stringify(printed.map(String));
    expect(output).not.toMatch(/hunter22|ECONNREFUSED|SERVER_ERROR/);
  });

  // The insert itself fails, as a database error would. Better Auth then logs "Failed to create
  // user" with the whole error attached; only the message may reach the console.
  it("doesn't print the email or the cause when storing a user fails", async () => {
    const { route, auth } = setup();
    const { internalAdapter } = await auth.$context;
    vi.spyOn(internalAdapter, "createUser").mockRejectedValue(
      new Error(
        "connect ECONNREFUSED postgres://u:hunter22@db ada@example.com",
      ),
    );
    const printed: unknown[] = [];
    for (const method of ["log", "warn", "error", "info", "debug"] as const)
      vi.spyOn(console, method).mockImplementation((...args) => {
        printed.push(...args);
      });
    const response = await route.POST(post("/sign-up/email", ADA), params);
    // Better Auth's own answer for a failed insert (FAILED_TO_CREATE_USER). Auth endpoints pass Better
    // Auth's error responses through in its { code, message } shape; only crashes become our 500.
    expect(response.status).toBe(422);
    const text = await response.text();
    expect(text).not.toMatch(/hunter22|ECONNREFUSED/);
    const output = JSON.stringify(printed.map(String));
    expect(output).toContain("Failed to create user");
    expect(output).not.toMatch(/hunter22|ECONNREFUSED|ada@example\.com/);
  });
});
