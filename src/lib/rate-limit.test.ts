import { afterEach, describe, expect, it, vi } from "vitest";

const logError = vi.fn();
vi.mock("@/lib/log", () => ({
  log: { error: logError, warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
// Counting against PostgreSQL is covered by rate-limit.int.test.ts. Here the database is a fake,
// to show the limiter fails closed when it can't count.
const queryRaw = vi.fn();
const deleteMany = vi.fn();
vi.mock("@/lib/db", () => ({
  db: { $queryRaw: queryRaw, apiRateLimit: { deleteMany } },
}));

const {
  checkRateLimit,
  RateLimitConfigError,
  readRateLimits,
  resetRateLimitOverrides,
  retryAfterSeconds,
  setRateLimitOverrides,
  windowStart,
} = await import("./rate-limit");

afterEach(() => {
  resetRateLimitOverrides();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("readRateLimits", () => {
  it("uses the documented defaults when nothing is set", () => {
    expect(readRateLimits({})).toEqual({
      aiPerMinute: 20,
      aiPerDay: 300,
      aiGlobalPerDay: 2000,
      uploadsPerHour: 10,
    });
  });

  it("reads each RATE_LIMIT_* variable", () => {
    expect(
      readRateLimits({
        RATE_LIMIT_AI_PER_MIN: "5",
        RATE_LIMIT_AI_PER_DAY: " 50 ",
        RATE_LIMIT_AI_GLOBAL_PER_DAY: "500",
        RATE_LIMIT_UPLOADS_PER_HOUR: "3",
      }),
    ).toEqual({
      aiPerMinute: 5,
      aiPerDay: 50,
      aiGlobalPerDay: 500,
      uploadsPerHour: 3,
    });
  });

  it("accepts the largest allowed limit, 999999999", () => {
    expect(
      readRateLimits({ RATE_LIMIT_AI_GLOBAL_PER_DAY: "999999999" })
        .aiGlobalPerDay,
    ).toBe(999_999_999);
  });

  it("treats an empty variable as unset", () => {
    expect(readRateLimits({ RATE_LIMIT_AI_PER_MIN: "" }).aiPerMinute).toBe(20);
  });

  it.each(["0", "-1", "abc", "1.5", "1e3", "10x", "9999999999"])(
    "fails closed on %j instead of guessing a limit, and names the variable, not the value",
    (value) => {
      expect(() =>
        readRateLimits({ RATE_LIMIT_UPLOADS_PER_HOUR: value }),
      ).toThrow(RateLimitConfigError);
      expect(() =>
        readRateLimits({ RATE_LIMIT_UPLOADS_PER_HOUR: value }),
      ).toThrow(/RATE_LIMIT_UPLOADS_PER_HOUR/);
      const logged = JSON.stringify(logError.mock.calls);
      expect(logged).toContain("RATE_LIMIT_UPLOADS_PER_HOUR");
      if (value !== "0" && value !== "-1") expect(logged).not.toContain(value);
    },
  );

  it("reads process.env by default", () => {
    vi.stubEnv("RATE_LIMIT_AI_PER_DAY", "7");
    expect(readRateLimits().aiPerDay).toBe(7);
  });
});

describe("windows", () => {
  const MINUTE = 60_000;

  it("starts fixed windows on whole multiples of their length, in UTC", () => {
    const now = new Date("2026-11-06T21:34:56.789Z");
    expect(windowStart(now, MINUTE).toISOString()).toBe(
      "2026-11-06T21:34:00.000Z",
    );
    expect(windowStart(now, 60 * MINUTE).toISOString()).toBe(
      "2026-11-06T21:00:00.000Z",
    );
    expect(windowStart(now, 24 * 60 * MINUTE).toISOString()).toBe(
      "2026-11-06T00:00:00.000Z",
    );
  });

  it("counts Retry-After in whole seconds up to the window's end", () => {
    const start = new Date("2026-11-06T21:34:00.000Z");
    expect(
      retryAfterSeconds(start, MINUTE, new Date("2026-11-06T21:34:00.000Z")),
    ).toBe(60);
    expect(
      retryAfterSeconds(start, MINUTE, new Date("2026-11-06T21:34:59.001Z")),
    ).toBe(1);
    expect(
      retryAfterSeconds(start, MINUTE, new Date("2026-11-06T21:34:30.500Z")),
    ).toBe(30);
  });

  it("never asks a client to retry after 0 seconds", () => {
    const start = new Date("2026-11-06T21:34:00.000Z");
    expect(
      retryAfterSeconds(start, MINUTE, new Date("2026-11-06T21:35:00.000Z")),
    ).toBe(1);
  });
});

describe("test overrides", () => {
  it("are refused in production, so a stray call can't change real limits", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(() => setRateLimitOverrides({ limits: { aiPerMinute: 1 } })).toThrow(
      /test/i,
    );
  });
});

describe("checkRateLimit fails closed", () => {
  it("rejects, rather than allow the request, when the database can't count", async () => {
    deleteMany.mockResolvedValue({ count: 0 });
    queryRaw.mockRejectedValue(new Error("connection refused"));
    await expect(checkRateLimit("u1", "ai")).rejects.toThrow(
      "connection refused",
    );
  });

  it("rejects when a RATE_LIMIT_* setting is invalid, before counting anything", async () => {
    vi.stubEnv("RATE_LIMIT_AI_PER_MIN", "abc");
    await expect(checkRateLimit("u1", "ai")).rejects.toThrow(
      RateLimitConfigError,
    );
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it("still counts the request when sweeping old windows fails", async () => {
    deleteMany.mockRejectedValue(new Error("lock timeout"));
    queryRaw.mockResolvedValue([{ count: 1 }]);
    expect(await checkRateLimit("u1", "upload")).toEqual({ allowed: true });
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });
});

describe("checkRateLimit with the real clock", () => {
  afterEach(() => vi.useRealTimers());

  it("counts in the current window when no clock is injected", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-06T21:34:56.000Z"));
    deleteMany.mockResolvedValue({ count: 0 });
    queryRaw.mockResolvedValue([{ count: 1 }]);
    await checkRateLimit("u1", "upload");
    // A tagged template: the bound values follow the SQL strings.
    const [, key, start] = queryRaw.mock.calls[0];
    expect(key).toBe("u1:upload:hour");
    expect(start).toEqual(new Date("2026-11-06T21:00:00.000Z"));
  });

  it("sweeps old windows at most once an hour", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-06T21:00:00.000Z"));
    deleteMany.mockResolvedValue({ count: 0 });
    queryRaw.mockResolvedValue([{ count: 1 }]);
    await checkRateLimit("u1", "upload");
    vi.setSystemTime(new Date("2026-11-06T21:59:00.000Z"));
    await checkRateLimit("u1", "upload");
    expect(deleteMany).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date("2026-11-06T22:00:01.000Z"));
    await checkRateLimit("u1", "upload");
    expect(deleteMany).toHaveBeenCalledTimes(2);
  });
});
