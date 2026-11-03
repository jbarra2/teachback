// Empties every table between integration test files (T07). Guarded three ways before anything is
// deleted: the URLs must be a local `_test` database, the guard runs again right here, and the
// connection itself is asked which database it reached.
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { assertTestDatabase } from "./test-db";

type Delegate = {
  deleteMany: () => Prisma.PrismaPromise<unknown>;
  count: () => Prisma.PrismaPromise<number>;
};

const delegates = db as unknown as Record<string, Delegate>;
const models = () =>
  Object.values(Prisma.ModelName).map(
    (model) => model[0].toLowerCase() + model.slice(1),
  );

/** Deletes every row of every model. Foreign keys all cascade (T02), so order doesn't matter. */
export async function resetDatabase(): Promise<void> {
  assertTestDatabase();
  // What the connection really reached, whatever the environment says.
  const [{ name }] = await db.$queryRaw<{ name: string }[]>`
    SELECT current_database() AS name`;
  if (!/^.+_test$/.test(name))
    throw new Error(
      `Connected to database "${name}", not a _test database. Nothing was deleted.`,
    );
  await db.$transaction(models().map((model) => delegates[model].deleteMany()));
}

/** Throws unless every table is empty: each integration file starts from nothing. */
export async function assertDatabaseEmpty(): Promise<void> {
  const all = models();
  const counts = await Promise.all(
    all.map((model) => delegates[model].count()),
  );
  const left = all.filter((_, i) => counts[i] > 0);
  if (left.length > 0)
    throw new Error(`The test database still has rows in: ${left.join(", ")}.`);
}
