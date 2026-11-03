import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assertTestDatabase, loadTestEnv } from "./test-db";

const GOOD = "postgresql://teachback:teachback@127.0.0.1:5434/teachback_test";
const env = (url: string | undefined, direct: string | undefined = url) => ({
  DATABASE_URL: url,
  DIRECT_URL: direct,
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("assertTestDatabase (the guard before any migrate or truncate)", () => {
  it.each([
    GOOD,
    "postgresql://u:p@localhost:5434/teachback_test",
    "postgres://u:p@[::1]:5434/teachback_test",
    "postgresql://u:p@127.0.0.1:5432/app_test",
  ])("accepts a loopback database whose name ends in _test: %s", (url) => {
    expect(() => assertTestDatabase(env(url))).not.toThrow();
  });

  it.each([
    [
      "the dev database",
      "postgresql://teachback:teachback@127.0.0.1:5433/teachback",
    ],
    [
      "a _test database on another host",
      "postgresql://u@db.example.com:5432/teachback_test",
    ],
    ["a private-network host", "postgresql://u@10.0.0.5:5432/teachback_test"],
    [
      "a name that only contains _test",
      "postgresql://u:p@127.0.0.1:5434/teachback_test_backup",
    ],
    ["a name that is just _test", "postgresql://u:p@127.0.0.1:5434/_test"],
    // Clients decode and split the path differently (decodeURI, decodeURIComponent, the engine's
    // own parser), so only plain names pass: what the guard reads is what every client reads.
    [
      "a path with another segment",
      "postgresql://u:p@127.0.0.1:5434/teachback/x_test",
    ],
    [
      "an encoded slash in the name",
      "postgresql://u:p@127.0.0.1:5434/teachback%2Fx_test",
    ],
    [
      "an encoded character in the name",
      "postgresql://u:p@127.0.0.1:5434/teach%62ack_test",
    ],
    ["a hyphen in the name", "postgresql://u:p@127.0.0.1:5434/teach-back_test"],
    ["no database name", "postgresql://u:p@127.0.0.1:5434"],
    ["another protocol", "mysql://u:p@127.0.0.1:3306/teachback_test"],
    ["not a URL", "teachback_test"],
    // PostgreSQL clients take the host and port from these over the URL's own.
    [
      "a host query parameter",
      "postgresql://u:p@127.0.0.1:5434/teachback_test?host=db.example.com",
    ],
    [
      "a hostaddr query parameter",
      "postgresql://u:p@127.0.0.1:5434/teachback_test?hostaddr=10.0.0.5",
    ],
    [
      "a port query parameter",
      "postgresql://u:p@127.0.0.1:5434/teachback_test?port=5433",
    ],
    [
      "a dbname query parameter",
      "postgresql://u:p@127.0.0.1:5434/teachback_test?dbname=teachback",
    ],
    // The pg adapter ignores ?schema= while migrate honours it, so they'd use different schemas.
    [
      "a schema query parameter",
      "postgresql://u:p@127.0.0.1:5434/teachback_test?schema=public",
    ],
    // Without a port, pg takes PGPORT from the environment while the guard and Prisma use 5432.
    ["no port", "postgresql://u:p@127.0.0.1/teachback_test"],
  ])("refuses %s", (_name, url) => {
    expect(() => assertTestDatabase(env(url))).toThrow(/test database/i);
  });

  it("refuses when either URL is missing", () => {
    expect(() => assertTestDatabase(env(undefined))).toThrow(/DATABASE_URL/);
    expect(() => assertTestDatabase({ DATABASE_URL: GOOD })).toThrow(
      /DIRECT_URL/,
    );
  });

  it("refuses when DATABASE_URL and DIRECT_URL name different loopback hosts", () => {
    expect(() =>
      assertTestDatabase(
        env(
          "postgresql://u:p@127.0.0.1:5434/teachback_test",
          "postgresql://u:p@[::1]:5434/teachback_test",
        ),
      ),
    ).toThrow(/same database/i);
  });

  it("refuses when DATABASE_URL and DIRECT_URL point at different databases", () => {
    expect(() =>
      assertTestDatabase(
        env(GOOD, "postgresql://u:p@127.0.0.1:5434/other_test"),
      ),
    ).toThrow(/same database/i);
    expect(() =>
      assertTestDatabase(
        env(GOOD, "postgresql://u:p@127.0.0.1:5999/teachback_test"),
      ),
    ).toThrow(/same database/i);
  });

  it("never puts a password in the message", () => {
    // Refused for its name, so the message names the database and host, but never the password.
    const url = "postgresql://admin:hunter22-secret@127.0.0.1:5432/prod";
    expect(() => assertTestDatabase(env(url))).toThrow();
    try {
      assertTestDatabase(env(url));
    } catch (error) {
      expect(String(error)).toContain('database "prod" on 127.0.0.1');
      expect(String(error)).not.toContain("hunter22-secret");
    }
  });

  it("checks the real environment by default", () => {
    vi.stubEnv("DATABASE_URL", "postgresql://u:p@127.0.0.1:5433/teachback");
    vi.stubEnv("DIRECT_URL", "postgresql://u:p@127.0.0.1:5433/teachback");
    expect(() => assertTestDatabase()).toThrow(/test database/i);
  });
});

describe("loadTestEnv", () => {
  // It writes process.env directly, so put it back after each test.
  let saved: NodeJS.ProcessEnv;
  beforeEach(() => {
    saved = { ...process.env };
  });
  afterEach(() => {
    for (const name of Object.keys(process.env))
      if (!(name in saved)) delete process.env[name];
    Object.assign(process.env, saved);
  });

  it("loads .env.test over whatever the shell or .env set", () => {
    vi.stubEnv("DATABASE_URL", "postgresql://u:p@127.0.0.1:5433/teachback");
    vi.stubEnv("BETTER_AUTH_SECRET", "something-else-from-a-developer-shell");
    const loaded = loadTestEnv();
    const file = readFileSync(
      path.resolve(import.meta.dirname, "../../.env.test"),
      "utf8",
    );
    expect(file).toContain(`DATABASE_URL=${process.env.DATABASE_URL}`);
    expect(process.env.BETTER_AUTH_SECRET).toBe(loaded.BETTER_AUTH_SECRET);
    expect(process.env.DATABASE_URL).toMatch(/_test$/);
  });

  // .env.test blanks these on purpose, so a developer's real key or a forced AI failure in their
  // shell can't reach the integration tests.
  it("blanks what .env.test leaves empty, over the shell's values", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-from-a-developer-shell");
    vi.stubEnv("AI_FAKE_FAILURE", "timeout");
    vi.stubEnv("TRUSTED_IP_HEADER", "x-forwarded-for");
    loadTestEnv();
    expect(process.env.ANTHROPIC_API_KEY).toBe("");
    expect(process.env.AI_FAKE_FAILURE).toBe("");
    expect(process.env.TRUSTED_IP_HEADER).toBe("");
  });

  it("passes the guard right after loading", () => {
    loadTestEnv();
    expect(() => assertTestDatabase()).not.toThrow();
  });
});
