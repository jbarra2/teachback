// Runs in each integration test file before its imports (T07): .env.test first, so the app's
// modules (db.ts reads DATABASE_URL when imported) see the test database; then an empty database
// for the file, and a closed connection pool at the end.
import { afterAll, beforeAll } from "vitest";
import { loadTestEnv } from "../helpers/test-db";

loadTestEnv();

beforeAll(async () => {
  const { assertDatabaseEmpty, resetDatabase } =
    await import("../helpers/reset-db");
  await resetDatabase();
  await assertDatabaseEmpty();
});

afterAll(async () => {
  const { db } = await import("@/lib/db");
  await db.$disconnect();
});
