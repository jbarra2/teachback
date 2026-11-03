import { afterEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@/generated/prisma/client";
import { assertDatabaseEmpty, resetDatabase } from "../helpers/reset-db";
import { readTestEnv } from "../helpers/test-db";
import setup from "./global-setup";

// The integration setup's wiring (T07): the guard runs before anything migrates or deletes, so a
// dev database is refused before a single statement. Nothing here touches a real database: the
// Prisma client and the migrate command are mocked and record what would have run. The modules are
// imported once, up front, so loading the Prisma client never counts against a test's time limit.
const mocks = vi.hoisted(() => ({
  execFileSync: vi.fn(),
  // Each records the delegate it was called on. deleteMany returns a marker, as Prisma returns a
  // lazy query that only runs inside the $transaction it's passed to.
  deleteMany: vi.fn((model: string) => ({ deleteFrom: model })),
  count: vi.fn<(model: string) => Promise<number>>(async () => 0),
  transaction: vi.fn(async (ops: unknown[]) => ops),
  // The database the connection says it reached (SELECT current_database()).
  currentDatabase: vi.fn(async () => [{ name: "teachback_test" }]),
}));
const { execFileSync, deleteMany, count } = mocks;
const $transaction = mocks.transaction;
const $queryRaw = mocks.currentDatabase;
vi.mock("node:child_process", () => ({ execFileSync: mocks.execFileSync }));
// Answers only the delegate names a real PrismaClient has (user, rateLimit, ...), so reset-db has
// to get them right; anything else is undefined, as on the client. The real client never connects.
vi.mock("@/lib/db", async () => {
  const { PrismaClient } = await import("@/generated/prisma/client");
  const { PrismaPg } = await import("@prisma/adapter-pg");
  const real = new PrismaClient({
    adapter: new PrismaPg({
      connectionString: "postgresql://u:p@127.0.0.1:9/none",
    }),
  });
  return {
    db: new Proxy(
      { $transaction: mocks.transaction, $queryRaw: mocks.currentDatabase },
      {
        get: (target, key) =>
          key in target
            ? target[key as keyof typeof target]
            : typeof key === "string" && !key.startsWith("$") && key in real
              ? {
                  deleteMany: () => mocks.deleteMany(key),
                  count: () => mocks.count(key),
                }
              : undefined,
      },
    ),
  };
});

// .env.test can't be what decides these tests, so reading it yields nothing here.
vi.mock("../helpers/test-db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../helpers/test-db")>()),
  readTestEnv: vi.fn(() => ({})),
}));

// A non-test database on a closed port: refused by the guard, and unreachable even if it weren't.
const DEV = "postgresql://u:p@127.0.0.1:9/teachback";
const TEST = "postgresql://teachback:teachback@127.0.0.1:5434/teachback_test";

function pointAt(url: string) {
  vi.stubEnv("DATABASE_URL", url);
  vi.stubEnv("DIRECT_URL", url);
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("global setup (migrate once)", () => {
  it("refuses the dev database before running any migration", async () => {
    pointAt(DEV);
    expect(() => setup()).toThrow(/test database/i);
    expect(execFileSync).not.toHaveBeenCalled();
  });

  // The shell is fine but .env.test, which wins and is what gets migrated, points elsewhere.
  it("refuses a .env.test that points at the dev database, whatever the shell says", async () => {
    pointAt(TEST);
    vi.mocked(readTestEnv).mockReturnValueOnce({
      DATABASE_URL: DEV,
      DIRECT_URL: DEV,
    });
    expect(() => setup()).toThrow(/test database/i);
    expect(execFileSync).not.toHaveBeenCalled();
  });

  it("reads .env.test, then migrates the test database with the Prisma CLI", async () => {
    pointAt(TEST);
    setup();
    expect(readTestEnv).toHaveBeenCalledOnce();
    expect(execFileSync).toHaveBeenCalledOnce();
    const [, args, options] = execFileSync.mock.calls[0];
    expect(args.slice(-2)).toEqual(["migrate", "deploy"]);
    expect(options.env).toMatchObject({
      DIRECT_URL: TEST,
      CHECKPOINT_DISABLE: "1",
    });
  });

  // Vitest 5.0.5 crashes while source-mapping a global setup error's stack (Vite 8.3.5's module
  // runner meets a Buffer where it expects a string), so the developer saw only "TypeError:
  // code.charCodeAt is not a function". The error goes out with its message as its whole stack.
  it("throws its refusal with the message as the whole stack, so Vitest prints it", async () => {
    pointAt(DEV);
    let thrown: unknown;
    try {
      setup();
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    const { message, stack } = thrown as Error;
    expect(message).toMatch(/must be a local test database/);
    expect(stack).toBe(`Error: ${message}`);
  });

  const failMigrate = (stderr: string) =>
    execFileSync.mockImplementationOnce(() => {
      throw Object.assign(new Error("Command failed: node prisma"), {
        stderr: Buffer.from(stderr),
      });
    });

  it("says to start the test database when Prisma can't reach it", async () => {
    pointAt(TEST);
    failMigrate(
      "Error: P1001: Can't reach database server at `127.0.0.1:5434`\n",
    );
    expect(() => setup()).toThrow(
      /test database isn't running on 127\.0\.0\.1:5434[\s\S]*npm run db:up/,
    );
    expect(() => setup()).not.toThrow(/teachback:teachback@/);
  });

  it("passes any other migrate failure through with Prisma's own output", async () => {
    pointAt(TEST);
    failMigrate("Error: P3009\nmigrate found failed migrations\n");
    let thrown: unknown;
    try {
      setup();
    } catch (error) {
      thrown = error;
    }
    expect((thrown as Error).message).toMatch(
      /Migrating the test database failed[\s\S]*P3009[\s\S]*failed migrations/,
    );
    expect((thrown as Error).stack).toBe(`Error: ${(thrown as Error).message}`);
  });
});

// It runs in Vitest's main process, whose environment the unit projects' workers inherit. Loading
// .env.test there gave the unit tests its public secret, which production-mode tests refuse.
it("leaves process.env as it was, so other projects don't inherit .env.test", async () => {
  pointAt(TEST);
  vi.mocked(readTestEnv).mockReturnValueOnce({
    DATABASE_URL: TEST,
    DIRECT_URL: TEST,
    BETTER_AUTH_SECRET: "from-env-test",
  });
  vi.stubEnv("BETTER_AUTH_SECRET", "the-shell-value");
  setup();
  expect(process.env.BETTER_AUTH_SECRET).toBe("the-shell-value");
  expect(execFileSync.mock.calls[0][2].env.BETTER_AUTH_SECRET).toBe(
    "from-env-test",
  );
});

describe("resetDatabase (empty every table between files)", () => {
  it("refuses the dev database before deleting anything", async () => {
    pointAt(DEV);
    await expect(resetDatabase()).rejects.toThrow(/test database/i);
    expect(deleteMany).not.toHaveBeenCalled();
    expect($transaction).not.toHaveBeenCalled();
  });

  it("refuses when the connection reached a database that isn't a _test one, whatever the URL said", async () => {
    pointAt(TEST);
    $queryRaw.mockResolvedValueOnce([{ name: "teachback" }]);
    await expect(resetDatabase()).rejects.toThrow(
      /"teachback".*Nothing was deleted/,
    );
    expect($transaction).not.toHaveBeenCalled();
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it("deletes from every model in one transaction on the test database", async () => {
    pointAt(TEST);
    await resetDatabase();
    // A different delegate for each model (the mock only answers real ones), every one of them.
    const deleted = deleteMany.mock.calls.map(([model]) => model);
    expect(new Set(deleted).size).toBe(Object.keys(Prisma.ModelName).length);
    expect(deleted).toHaveLength(Object.keys(Prisma.ModelName).length);
    // All of those deletes, and nothing else, in one transaction.
    expect($transaction).toHaveBeenCalledOnce();
    expect($transaction.mock.calls[0][0]).toEqual(
      deleted.map((model) => ({ deleteFrom: model })),
    );
  });
});

describe("assertDatabaseEmpty (each file starts from nothing)", () => {
  it("passes when every table is empty", async () => {
    await expect(assertDatabaseEmpty()).resolves.toBeUndefined();
  });

  it("names the tables that still have rows", async () => {
    count.mockResolvedValueOnce(2);
    await expect(assertDatabaseEmpty()).rejects.toThrow(
      /still has rows in: [a-z]/,
    );
  });
});
