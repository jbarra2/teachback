// Rate limits (T14, PLAN §7, TESTING §3 S6): fixed windows counted in PostgreSQL, so every server
// process shares them. Each window is one `ApiRateLimit` row, incremented with a single atomic
// INSERT ... ON CONFLICT, so parallel requests can't both take the last slot.
//
// - `ai`: per user per minute, then per user per day, then a global daily cap across all users,
//   so creating extra accounts can't drain the API credits.
// - `upload`: per user per hour.
//
// Each window is counted only when the ones before it allowed the request: a user spamming past
// their own limit uses up neither their daily allowance nor everyone else's global cap.
import { log } from "@/lib/log";

// Loaded on first use, like the session lookup: withApi imports this module for every route,
// including ones (and their tests) that never touch the database.
const database = async () => (await import("@/lib/db")).db;

export type RateLimitBucket = "ai" | "upload";

export interface RateLimits {
  aiPerMinute: number;
  aiPerDay: number;
  aiGlobalPerDay: number;
  uploadsPerHour: number;
}

export type RateLimitResult =
  { allowed: true } | { allowed: false; retryAfter: number };

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** The defaults match .env.example. */
const SETTINGS: Record<keyof RateLimits, { env: string; fallback: number }> = {
  aiPerMinute: { env: "RATE_LIMIT_AI_PER_MIN", fallback: 20 },
  aiPerDay: { env: "RATE_LIMIT_AI_PER_DAY", fallback: 300 },
  aiGlobalPerDay: { env: "RATE_LIMIT_AI_GLOBAL_PER_DAY", fallback: 2000 },
  uploadsPerHour: { env: "RATE_LIMIT_UPLOADS_PER_HOUR", fallback: 10 },
};

/** A RATE_LIMIT_* setting that isn't a whole number from 1 to 999,999,999. */
export class RateLimitConfigError extends Error {
  override name = "RateLimitConfigError";
}

type Env = Record<string, string | undefined>;

/** The limits from the environment. An unset or empty variable uses its default. */
export function readRateLimits(env: Env = process.env): RateLimits {
  const limits = {} as RateLimits;
  for (const [name, { env: variable, fallback }] of Object.entries(SETTINGS)) {
    const raw = env[variable]?.trim();
    if (!raw) {
      limits[name as keyof RateLimits] = fallback;
      continue;
    }
    // Fail closed rather than guess: a typo must not turn a limit off or into something else.
    if (!/^[1-9]\d{0,8}$/.test(raw)) {
      const message = `${variable} must be a whole number from 1 to 999999999.`;
      // Names the setting, never its value.
      log.error(`Rate limits aren't configured: ${message}`);
      throw new RateLimitConfigError(message);
    }
    limits[name as keyof RateLimits] = Number(raw);
  }
  return limits;
}

/** The start of the fixed window of this length that holds `now` (UTC, aligned to the epoch). */
export function windowStart(now: Date, length: number): Date {
  return new Date(Math.floor(now.getTime() / length) * length);
}

/** Whole seconds until the window ends, at least 1. */
export function retryAfterSeconds(
  start: Date,
  length: number,
  now: Date,
): number {
  return Math.max(
    1,
    Math.ceil((start.getTime() + length - now.getTime()) / 1000),
  );
}

interface Window {
  /** The key's owner part: the user id, or "global". */
  owner: string;
  name: string;
  length: number;
  limit: number;
}

function windowsFor(
  userId: string,
  bucket: RateLimitBucket,
  limits: RateLimits,
): Window[] {
  if (bucket === "upload")
    return [
      {
        owner: userId,
        name: "upload:hour",
        length: HOUR,
        limit: limits.uploadsPerHour,
      },
    ];
  return [
    {
      owner: userId,
      name: "ai:min",
      length: MINUTE,
      limit: limits.aiPerMinute,
    },
    { owner: userId, name: "ai:day", length: DAY, limit: limits.aiPerDay },
    {
      owner: "global",
      name: "ai:day",
      length: DAY,
      limit: limits.aiGlobalPerDay,
    },
  ];
}

/** Adds one to the window's count and returns the new count, in one statement. */
async function hit(key: string, start: Date): Promise<number> {
  const db = await database();
  const [row] = await db.$queryRaw<{ count: number }[]>`
    INSERT INTO "ApiRateLimit" ("key", "windowStart", "count")
    VALUES (${key}, ${start}, 1)
    ON CONFLICT ("key", "windowStart")
    DO UPDATE SET "count" = "ApiRateLimit"."count" + 1
    RETURNING "count"`;
  return row.count;
}

/** Rows have no foreign key, so old windows (including deleted users') are swept now and then. */
const KEEP_FOR = 2 * DAY;
const SWEEP_EVERY = HOUR;
let lastSweep = Number.NEGATIVE_INFINITY;

async function sweepOldWindows(now: Date): Promise<void> {
  if (now.getTime() - lastSweep < SWEEP_EVERY) return;
  lastSweep = now.getTime();
  try {
    const db = await database();
    await db.apiRateLimit.deleteMany({
      where: { windowStart: { lt: new Date(now.getTime() - KEEP_FOR) } },
    });
  } catch (error) {
    // Housekeeping only: the limit itself is still checked below.
    log.warn("Couldn't delete old rate-limit windows", {
      errorName: error instanceof Error ? error.name : typeof error,
    });
  }
}

interface Overrides {
  limits?: Partial<RateLimits>;
  now?: () => Date;
}
let overrides: Overrides = {};

/** Tests set low limits and their own clock explicitly (TESTING §3, S6). Never in production. */
export function setRateLimitOverrides(next: Overrides): void {
  if (process.env.NODE_ENV === "production")
    throw new Error("Rate-limit overrides are for tests only.");
  overrides = next;
}

export function resetRateLimitOverrides(): void {
  overrides = {};
  lastSweep = Number.NEGATIVE_INFINITY;
}

/**
 * Counts one request by this user against the bucket. Throws (so the request fails with a 500)
 * when the limits are misconfigured or the database can't be reached: it never lets a request
 * through unchecked.
 */
export async function checkRateLimit(
  userId: string,
  bucket: RateLimitBucket,
  options: { limits?: RateLimits; now?: Date } = {},
): Promise<RateLimitResult> {
  const limits = options.limits ?? {
    ...readRateLimits(),
    ...overrides.limits,
  };
  const now = options.now ?? overrides.now?.() ?? new Date();
  await sweepOldWindows(now);
  for (const window of windowsFor(userId, bucket, limits)) {
    const start = windowStart(now, window.length);
    const count = await hit(`${window.owner}:${window.name}`, start);
    if (count > window.limit)
      return {
        allowed: false,
        retryAfter: retryAfterSeconds(start, window.length, now),
      };
  }
  return { allowed: true };
}
