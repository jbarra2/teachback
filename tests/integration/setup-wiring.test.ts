import { afterAll, describe, expect, it, vi } from "vitest";

// What tests/integration/setup.ts does around every integration file (T07), with its pieces
// mocked: importing it here registers its hooks on this file, so they run around the test below.
const calls: string[] = [];
const loadTestEnv = vi.fn(() => {
  calls.push("loadTestEnv");
  return {};
});
const $disconnect = vi.fn(async () => {
  calls.push("$disconnect");
});
vi.mock("../helpers/test-db", () => ({ loadTestEnv }));
vi.mock("../helpers/reset-db", () => ({
  resetDatabase: vi.fn(async () => {
    calls.push("resetDatabase");
  }),
  assertDatabaseEmpty: vi.fn(async () => {
    calls.push("assertDatabaseEmpty");
  }),
}));
vi.mock("@/lib/db", () => ({ db: { $disconnect } }));

// Registered before setup's own: after-hooks run in reverse order (Vitest's "stack" default), so
// this one runs last and sees whether setup closed the pool.
afterAll(() => {
  expect(calls.at(-1)).toBe("$disconnect");
  expect($disconnect).toHaveBeenCalledOnce();
});

await import("./setup");
// A test file's own imports run before any hook, and db.ts reads DATABASE_URL when it's imported,
// so .env.test has to be loaded while setup.ts is imported, not in a hook.
const atImport = [...calls];

describe("integration setup (each file)", () => {
  it("loads .env.test as soon as it's imported, before any hook", () => {
    expect(atImport).toEqual(["loadTestEnv"]);
  });

  it("then empties the database and checks it is empty, before the file's tests", () => {
    expect(calls).toEqual([
      "loadTestEnv",
      "resetDatabase",
      "assertDatabaseEmpty",
    ]);
  });
});
