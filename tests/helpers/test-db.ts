// The integration tests' database safety (T07). Migrate and truncate only ever touch a database
// whose name ends in `_test` on this machine: the guard runs before migrating and again before
// every truncate, and the URLs come from .env.test, loaded over the shell and .env, so a
// developer's own DATABASE_URL can't send the tests to their dev database.
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";

type Env = Record<string, string | undefined>;

const ENV_TEST = path.resolve(import.meta.dirname, "../../.env.test");
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

/** The values in .env.test, without touching process.env. */
export function readTestEnv(): Record<string, string> {
  return parseEnv(readFileSync(ENV_TEST, "utf8")) as Record<string, string>;
}

/**
 * Loads .env.test into process.env, replacing values the shell or .env already set. Only for the
 * integration project's own workers: the global setup runs in Vitest's main process, whose
 * environment every project's workers inherit, so it uses readTestEnv instead.
 */
export function loadTestEnv(): Record<string, string> {
  const values = readTestEnv();
  for (const [name, value] of Object.entries(values)) process.env[name] = value;
  return values;
}

interface Target {
  host: string;
  port: string;
  database: string;
}

/** Where a URL points, or why it isn't a local test database. Never echoes the URL. */
function target(name: string, url: string | undefined): Target {
  if (!url)
    throw new Error(`${name} is not set, so there is no test database to use.`);
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`${name} isn't a URL, so it can't be the test database.`);
  }
  // Only what every client reads the same way: the guard, pg (the app and the reset) and Prisma's
  // migrate engine.
  // - The path is never decoded, since clients decode and split it differently: a plain name only.
  // - An explicit port: without one, pg falls back to PGPORT from the environment.
  // - No query at all: pg takes host, port and dbname from it over the URL's own, and the pg
  //   adapter ignores the ?schema= that migrate honours.
  const database = parsed.pathname.replace(/^\//, "");
  const ok =
    (parsed.protocol === "postgresql:" || parsed.protocol === "postgres:") &&
    LOOPBACK.has(parsed.hostname) &&
    parsed.port !== "" &&
    /^[A-Za-z0-9_]+_test$/.test(database) &&
    parsed.search === "" &&
    parsed.hash === "";
  if (!ok)
    throw new Error(
      `${name} must be a local test database (127.0.0.1, localhost or ::1 with a port, a name of letters, digits and _ ending in _test, no query). ` +
        `It points at database "${database || "(none)"}" on ${parsed.hostname || "(no host)"}.`,
    );
  return { host: parsed.hostname, port: parsed.port, database };
}

/**
 * Throws unless DATABASE_URL and DIRECT_URL are both the same local `_test` database. Call it
 * before anything that migrates, truncates or deletes.
 */
export function assertTestDatabase(env: Env = process.env): void {
  const runtime = target("DATABASE_URL", env.DATABASE_URL);
  const direct = target("DIRECT_URL", env.DIRECT_URL);
  if (
    runtime.host !== direct.host ||
    runtime.port !== direct.port ||
    runtime.database !== direct.database
  )
    throw new Error(
      "DATABASE_URL and DIRECT_URL must point at the same database for tests, so the migrated test database is the one that gets truncated.",
    );
}
