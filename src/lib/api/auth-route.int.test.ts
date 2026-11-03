import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/auth/[...all]/route";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { appOrigin, as } from "../../../tests/helpers/api";
import { withApi } from "./with-api";

// The auth route on PostgreSQL (T06's live checks, committed in T07). The unit tests use Better
// Auth's in-memory adapter, which has no unique indexes and clones its data per transaction; these
// run the real Prisma adapter, transactions and the database rate limiter.
const params = { params: Promise.resolve({ all: [] as string[] }) };
const ADA = {
  name: "Ada Lovelace",
  email: "ada@example.test",
  password: "correct-horse",
};

/** Each test counts rate limits from its own client IP (TRUSTED_IP_HEADER is x-real-ip here). */
let ipCounter = 0;
let ip = "";

function post(
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
) {
  return POST(
    new Request(`${appOrigin()}/api/auth${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: appOrigin(),
        "x-real-ip": ip,
        ...headers,
      },
      body: JSON.stringify(body),
    }),
    params,
  );
}

const getSession = (cookie: string) =>
  GET(
    new Request(`${appOrigin()}/api/auth/get-session`, { headers: { cookie } }),
    params,
  );

const wrongSignIn = (headers: Record<string, string> = {}) =>
  post(
    "/sign-in/email",
    { email: "nobody@example.test", password: "wrong-password" },
    headers,
  );

beforeEach(() => {
  vi.stubEnv("TRUSTED_IP_HEADER", "x-real-ip");
  ip = `198.51.100.${++ipCounter}`;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("auth route on PostgreSQL: the account flow", () => {
  it("signs up, signs in, reads the session through withApi, and signs out", async () => {
    const signUp = await post("/sign-up/email", ADA);
    expect(signUp.status).toBe(200);
    expect(await signUp.text()).toBe('{"success":true}');
    const user = await db.user.findUniqueOrThrow({
      where: { email: ADA.email },
    });
    const account = await db.account.findFirstOrThrow({
      where: { userId: user.id },
    });
    // Stored hashed, never as typed.
    expect(account.password).toBeTruthy();
    expect(account.password).not.toContain(ADA.password);
    expect(await db.session.count({ where: { userId: user.id } })).toBe(0);

    const signIn = await post("/sign-in/email", {
      email: ADA.email,
      password: ADA.password,
    });
    expect(signIn.status).toBe(200);
    const cookie = signIn.headers
      .getSetCookie()
      .find((c) => c.includes("session_token="))!
      .split(";")[0];
    expect(await db.session.count({ where: { userId: user.id } })).toBe(1);
    expect((await (await getSession(cookie)).json()).user.email).toBe(
      ADA.email,
    );

    const whoAmI = withApi(({ user: u }) => Response.json({ id: u?.id }));
    const me = await as({ ...ADA, id: user.id, cookie }).call(whoAmI, {
      url: "/api/courses",
    });
    expect(await me.json()).toEqual({ id: user.id });

    const signOut = await post("/sign-out", {}, { cookie });
    expect(signOut.status).toBe(200);
    expect(await db.session.count({ where: { userId: user.id } })).toBe(0);
    expect(await (await getSession(cookie)).json()).toBeNull();
  });

  it("answers a duplicate sign-up byte for byte like a new one, and stores nothing", async () => {
    // Its own address: the table is emptied per file, not per test, so ADA already exists here.
    const grace = { ...ADA, name: "Grace", email: "grace-dup@example.test" };
    const first = await post("/sign-up/email", grace);
    const user = await db.user.findUniqueOrThrow({
      where: { email: grace.email },
    });
    const accounts = () => db.account.count({ where: { userId: user.id } });
    expect(await accounts()).toBe(1);

    const again = await post("/sign-up/email", {
      ...grace,
      name: "Someone Else",
      password: "another-password",
    });
    expect(again.status).toBe(first.status);
    expect(await again.text()).toBe(await first.text());
    expect(again.headers.get("content-type")).toBe(
      first.headers.get("content-type"),
    );
    expect(again.headers.getSetCookie()).toEqual(first.headers.getSetCookie());
    expect(await db.user.count({ where: { email: grace.email } })).toBe(1);
    expect(await accounts()).toBe(1);
    // The first sign-up's name and password stand.
    expect(
      (await db.user.findUniqueOrThrow({ where: { id: user.id } })).name,
    ).toBe("Grace");
    await expect(
      auth.api.signInEmail({
        body: { email: grace.email, password: grace.password },
      }),
    ).resolves.toBeTruthy();
  });
});

describe("auth route on PostgreSQL: rate limits", () => {
  it("lets 3 sign-ins through in 10 s, then answers 429 with Retry-After, counted per IP", async () => {
    for (let i = 0; i < 3; i++) expect((await wrongSignIn()).status).toBe(401);
    const limited = await wrongSignIn();
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    const row = await db.rateLimit.findUniqueOrThrow({
      where: { key: `${ip}|/sign-in/email` },
    });
    expect(row.count).toBe(3);
    // Another client isn't affected.
    expect((await wrongSignIn({ "x-real-ip": "203.0.113.200" })).status).toBe(
      401,
    );
  });

  it("counts two first requests at once in one row (the unique key makes them collide)", async () => {
    // Hold each insert until both requests have read "no row" and tried to insert, so they
    // really collide; without this, the first insert can land before the second request reads.
    const create = db.rateLimit.create.bind(db.rateLimit);
    let arrived = 0;
    let release: () => void = () => {};
    const bothArrived = new Promise<void>((resolve) => (release = resolve));
    const outcomes: string[] = [];
    const timers: ReturnType<typeof setTimeout>[] = [];
    vi.spyOn(db.rateLimit, "create").mockImplementation(((
      args: Parameters<typeof create>[0],
    ) => {
      if (++arrived === 2) release();
      // A cap, so a request that never arrives fails the outcome check instead of hanging.
      const timeout = new Promise<void>((resolve) =>
        timers.push(setTimeout(resolve, 5_000)),
      );
      return Promise.race([bothArrived, timeout])
        .then(() => create(args))
        .then(
          (row) => (outcomes.push("created"), row),
          (error: unknown) => {
            outcomes.push((error as { code?: string }).code ?? "error");
            throw error;
          },
        );
    }) as unknown as typeof db.rateLimit.create);

    const both = await Promise.all([wrongSignIn(), wrongSignIn()]);
    timers.forEach(clearTimeout);
    expect(both.map((r) => r.status)).toEqual([401, 401]);
    // One insert won, the other hit the unique key and was counted as a second request instead.
    expect(outcomes.sort()).toEqual(["P2002", "created"]);
    const rows = await db.rateLimit.findMany({
      where: { key: `${ip}|/sign-in/email` },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].count).toBe(2);
  });

  it("lets at most 3 of a burst of 5 through", async () => {
    const burst = await Promise.all(
      Array.from({ length: 5 }, () => wrongSignIn()),
    );
    expect(burst.filter((r) => r.status === 401).length).toBeLessThanOrEqual(3);
    expect(burst.some((r) => r.status === 429)).toBe(true);
  });

  it("writes no rate-limit row for an endpoint the app doesn't use", async () => {
    const before = await db.rateLimit.count();
    const res = await post("/update-user", { name: "x" });
    expect(res.status).toBe(404);
    expect(await db.rateLimit.count()).toBe(before);
  });
});

describe("auth route on PostgreSQL: failures", () => {
  function captureConsole() {
    const printed: unknown[] = [];
    for (const method of ["log", "warn", "error", "info", "debug"] as const)
      vi.spyOn(console, method).mockImplementation((...args) => {
        printed.push(...args);
      });
    return () => JSON.stringify(printed.map(String));
  }

  it("answers a database error during sign-in with a 500 and a request id, printing nothing of it", async () => {
    const printed = captureConsole();
    const { internalAdapter } = await auth.$context;
    vi.spyOn(internalAdapter, "findUserByEmail").mockRejectedValue(
      new Error(
        "connect ECONNREFUSED postgres://u:hunter22@db ada@example.test",
      ),
    );
    const res = await post("/sign-in/email", {
      email: ADA.email,
      password: ADA.password,
    });
    expect(res.status).toBe(500);
    expect(res.headers.get("x-request-id")).toBeTruthy();
    expect(await res.text()).not.toMatch(/hunter22|ECONNREFUSED/);
    // The failure was logged (so the capture works), without the cause or the address.
    expect(printed()).toContain("Request failed");
    expect(printed()).not.toMatch(/hunter22|ECONNREFUSED|ada@example\.test/);
  });

  it("answers a failed insert with Better Auth's 422, printing neither the email nor the cause", async () => {
    const printed = captureConsole();
    const { internalAdapter } = await auth.$context;
    vi.spyOn(internalAdapter, "createUser").mockRejectedValue(
      new Error("connect ECONNREFUSED postgres://u:hunter22@db"),
    );
    // A new address: an existing one takes the duplicate path, which never inserts.
    const fresh = { ...ADA, email: "fresh-insert@example.test" };
    const res = await post("/sign-up/email", fresh);
    expect(res.status).toBe(422);
    const body = await res.text();
    expect(JSON.parse(body)).toMatchObject({ code: "FAILED_TO_CREATE_USER" });
    expect(body).not.toMatch(/hunter22|ECONNREFUSED|fresh-insert@/);
    expect(printed()).toContain("Failed to create user");
    expect(printed()).not.toMatch(/hunter22|ECONNREFUSED|fresh-insert@/);
    expect(await db.user.count({ where: { email: fresh.email } })).toBe(0);
  });
});
