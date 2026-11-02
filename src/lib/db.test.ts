import { afterEach, describe, expect, it, vi } from "vitest";

// db.ts reads the environment when it's first imported, so each test stubs it and imports afresh.
// Nothing here connects: a Prisma client opens its pool on the first query. A cold import of the
// Prisma client can pass Vitest's 5 s default on a busy machine.
vi.setConfig({ testTimeout: 30_000 });
const adapterConfigs = vi.hoisted((): unknown[] => []);
vi.mock("@prisma/adapter-pg", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@prisma/adapter-pg")>();
  class RecordingPrismaPg extends actual.PrismaPg {
    constructor(...args: ConstructorParameters<typeof actual.PrismaPg>) {
      super(...args);
      adapterConfigs.push(args[0]);
    }
  }
  return { ...actual, PrismaPg: RecordingPrismaPg };
});

// Closed ports, so an accidental query fails loudly instead of reaching a developer's database.
const DATABASE_URL = "postgresql://app:pw@127.0.0.1:9/pooled";
const DIRECT_URL = "postgresql://migrate:direct-secret@127.0.0.1:9/direct";
// Where db.ts keeps the client between module reloads (Next reloads modules in development).
const GLOBAL_KEY = "teachbackDb";

async function freshDb() {
  vi.resetModules();
  return (await import("./db")).db;
}

afterEach(() => {
  vi.unstubAllEnvs();
  adapterConfigs.length = 0;
  delete (globalThis as Record<string, unknown>)[GLOBAL_KEY];
});

describe("db", () => {
  it("connects through the pg adapter with DATABASE_URL, not DIRECT_URL", async () => {
    vi.stubEnv("DATABASE_URL", DATABASE_URL);
    vi.stubEnv("DIRECT_URL", DIRECT_URL);
    await freshDb();
    expect(adapterConfigs).toEqual([{ connectionString: DATABASE_URL }]);
  });

  it("hands the adapter the trimmed URL", async () => {
    vi.stubEnv("DATABASE_URL", ` ${DATABASE_URL}\n`);
    await freshDb();
    expect(adapterConfigs).toEqual([{ connectionString: DATABASE_URL }]);
  });

  // `test` is what Vitest sets: integration tests (T07) reload modules too.
  it.each(["development", "test"])(
    "reuses one client across module reloads when NODE_ENV=%s",
    async (nodeEnv) => {
      vi.stubEnv("NODE_ENV", nodeEnv);
      vi.stubEnv("DATABASE_URL", DATABASE_URL);
      const first = await freshDb();
      const second = await freshDb();
      expect(second).toBe(first);
      expect(adapterConfigs).toHaveLength(1);
    },
  );

  it("doesn't keep the client on globalThis in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DATABASE_URL", DATABASE_URL);
    const first = await freshDb();
    const second = await freshDb();
    expect(second).not.toBe(first);
    expect(GLOBAL_KEY in globalThis).toBe(false);
  });

  it.each([undefined, "", "   "])(
    "refuses to start when DATABASE_URL is %j, naming the variable but no value",
    async (value) => {
      vi.stubEnv("DATABASE_URL", value);
      vi.stubEnv("DIRECT_URL", DIRECT_URL);
      const error = await freshDb().then(
        () => null,
        (reason: unknown) => reason,
      );
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toMatch(/DATABASE_URL/);
      expect((error as Error).message).not.toMatch(/direct-secret|postgresql:/);
      expect(adapterConfigs).toEqual([]);
    },
  );
});
