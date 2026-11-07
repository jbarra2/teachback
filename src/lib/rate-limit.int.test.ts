import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import {
  checkRateLimit,
  resetRateLimitOverrides,
  setRateLimitOverrides,
  type RateLimits,
} from "./rate-limit";

// The limiter against PostgreSQL (db-test). Each test picks its own day through the injected clock,
// so the shared global window of one test never counts toward another's.
const LOW: RateLimits = {
  aiPerMinute: 3,
  aiPerDay: 5,
  aiGlobalPerDay: 4,
  uploadsPerHour: 2,
};
let day = 0;
/** A fresh UTC day for each test, at 12:00:30. */
function freshDay(): Date {
  day += 1;
  return new Date(Date.UTC(2030, 0, day, 12, 0, 30));
}
const user = (n: number) => `cuser${String(day).padStart(4, "0")}rl${n}`;

afterEach(() => resetRateLimitOverrides());

async function hits(
  count: number,
  userId: string,
  bucket: "ai" | "upload",
  now: Date,
  limits: RateLimits = LOW,
) {
  const results = [];
  for (let i = 0; i < count; i++)
    results.push(await checkRateLimit(userId, bucket, { limits, now }));
  return results;
}

describe("checkRateLimit (PostgreSQL)", () => {
  it("S6: allows up to the per-minute AI limit, then refuses until the minute ends", async () => {
    const now = freshDay();
    const results = await hits(4, user(1), "ai", now);
    expect(results.slice(0, 3)).toEqual([
      { allowed: true },
      { allowed: true },
      { allowed: true },
    ]);
    // 12:00:30 → the minute window ends at 12:01:00.
    expect(results[3]).toEqual({ allowed: false, retryAfter: 30 });
  });

  it("S6: a new minute window allows requests again", async () => {
    const now = freshDay();
    await hits(3, user(1), "ai", now);
    const nextMinute = new Date(now.getTime() + 60_000);
    expect(
      await checkRateLimit(user(1), "ai", { limits: LOW, now: nextMinute }),
    ).toEqual({ allowed: true });
  });

  it("S6: limits are per user", async () => {
    const now = freshDay();
    await hits(3, user(1), "ai", now);
    expect((await hits(1, user(1), "ai", now))[0].allowed).toBe(false);
    expect(await checkRateLimit(user(2), "ai", { limits: LOW, now })).toEqual({
      allowed: true,
    });
  });

  it("S6: the per-day AI limit holds across minutes, with Retry-After until midnight UTC", async () => {
    const now = freshDay();
    const limits = { ...LOW, aiPerMinute: 100, aiGlobalPerDay: 100 };
    const results = await hits(6, user(1), "ai", now, limits);
    expect(results.slice(0, 5).every((r) => r.allowed)).toBe(true);
    // 12:00:30 → midnight is 11 h 59 min 30 s away.
    expect(results[5]).toEqual({ allowed: false, retryAfter: 43_170 });
  });

  it("S6: the global daily AI cap stops every user, so extra accounts can't drain the credits", async () => {
    const now = freshDay();
    const limits = { ...LOW, aiPerMinute: 100, aiPerDay: 100 };
    for (let n = 1; n <= 4; n++)
      expect((await hits(1, user(n), "ai", now, limits))[0].allowed).toBe(true);
    expect(await checkRateLimit(user(5), "ai", { limits, now })).toEqual({
      allowed: false,
      retryAfter: 43_170,
    });
  });

  it("S6: requests one user makes past their own limit don't use up the global cap", async () => {
    const now = freshDay();
    const limits = { ...LOW, aiPerMinute: 2, aiPerDay: 100, aiGlobalPerDay: 3 };
    // Ten tries, two allowed: only those two may count globally.
    await hits(10, user(1), "ai", now, limits);
    expect(await checkRateLimit(user(2), "ai", { limits, now })).toEqual({
      allowed: true,
    });
  });

  it("S6: refused per-minute requests don't use up the per-day limit", async () => {
    const now = freshDay();
    const limits = { ...LOW, aiPerMinute: 2, aiPerDay: 3, aiGlobalPerDay: 100 };
    await hits(10, user(1), "ai", now, limits);
    const nextMinute = new Date(now.getTime() + 60_000);
    expect(
      await checkRateLimit(user(1), "ai", { limits, now: nextMinute }),
    ).toEqual({ allowed: true });
  });

  it("S6: uploads have their own hourly limit, separate from AI", async () => {
    const now = freshDay();
    const results = await hits(3, user(1), "upload", now);
    expect(results.map((r) => r.allowed)).toEqual([true, true, false]);
    // 12:00:30 → the hour ends at 13:00:00.
    expect(results[2]).toEqual({ allowed: false, retryAfter: 3_570 });
    expect(await checkRateLimit(user(1), "ai", { limits: LOW, now })).toEqual({
      allowed: true,
    });
  });

  it("counts atomically: 12 requests at once against a limit of 3 let exactly 3 through", async () => {
    const now = freshDay();
    const limits = {
      ...LOW,
      aiPerMinute: 3,
      aiPerDay: 100,
      aiGlobalPerDay: 100,
    };
    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        checkRateLimit(user(1), "ai", { limits, now }),
      ),
    );
    expect(results.filter((r) => r.allowed)).toHaveLength(3);
  });

  it("uses the overrides when no options are passed (how withApi calls it)", async () => {
    const now = freshDay();
    setRateLimitOverrides({ limits: { uploadsPerHour: 1 }, now: () => now });
    expect(await checkRateLimit(user(1), "upload")).toEqual({ allowed: true });
    expect(await checkRateLimit(user(1), "upload")).toEqual({
      allowed: false,
      retryAfter: 3_570,
    });
  });

  it("the sweep keeps live windows: a used-up daily limit stays used up", async () => {
    const now = freshDay();
    const today = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    const yesterday = new Date(today.getTime() - 86_400_000);
    const limits = {
      ...LOW,
      aiPerMinute: 100,
      aiPerDay: 5,
      aiGlobalPerDay: 100,
    };
    await db.apiRateLimit.createMany({
      data: [
        { key: `${user(1)}:ai:day`, windowStart: today, count: 5 },
        { key: `${user(2)}:ai:day`, windowStart: yesterday, count: 1 },
      ],
    });
    // A fresh process: the sweep is due on this request.
    resetRateLimitOverrides();
    expect(await checkRateLimit(user(1), "ai", { limits, now })).toEqual({
      allowed: false,
      retryAfter: 43_170,
    });
    expect(
      await db.apiRateLimit.count({
        where: { key: `${user(2)}:ai:day`, windowStart: yesterday },
      }),
    ).toBe(1);
  });

  it("deletes windows older than two days, and keeps recent ones", async () => {
    const now = freshDay();
    const old = new Date(now.getTime() - 3 * 86_400_000);
    await db.apiRateLimit.create({
      data: { key: `${user(9)}:ai:day`, windowStart: old, count: 1 },
    });
    await checkRateLimit(user(1), "upload", { limits: LOW, now });
    const left = await db.apiRateLimit.findMany({
      where: { key: { in: [`${user(9)}:ai:day`, `${user(1)}:upload:hour`] } },
      select: { key: true },
    });
    expect(left.map((row) => row.key)).toEqual([`${user(1)}:upload:hour`]);
  });
});
