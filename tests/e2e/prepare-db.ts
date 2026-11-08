// The e2e run's database steps (T29), run under tsx in their own process: the shared test helpers
// are ES modules, which Playwright's CommonJS loader can't import, and this keeps Prisma out of the
// test runner.
//
//   check    refuse unless .env.test is the local `_test` database (before the server starts)
//   prepare  the same check first, then migrate and empty every table
//
// Run by playwright.config.ts and global-setup.ts, never by hand.
import { execFileSync } from "node:child_process";
import path from "node:path";
import { assertTestDatabase, loadTestEnv } from "../helpers/test-db";

const root = path.resolve(import.meta.dirname, "../..");

async function main(step: string | undefined): Promise<void> {
  if (step !== "check" && step !== "prepare")
    throw new Error("Usage: prepare-db.ts check|prepare");

  // .env.test replaces whatever the shell or .env set, before anything reads DATABASE_URL.
  loadTestEnv();
  assertTestDatabase();
  if (step === "check") return;

  migrate();
  const { resetDatabase } = await import("../helpers/reset-db");
  const { db } = await import("@/lib/db");
  try {
    await resetDatabase();
  } finally {
    await db.$disconnect();
  }
}

function migrate(): void {
  try {
    execFileSync(
      process.execPath,
      [
        path.join(root, "node_modules/prisma/build/index.js"),
        "migrate",
        "deploy",
      ],
      {
        cwd: root,
        env: { ...process.env, CHECKPOINT_DISABLE: "1" },
        stdio: "pipe",
      },
    );
  } catch (error) {
    const output = String((error as { stderr?: unknown }).stderr ?? "").trim();
    throw new Error(
      /\bP1001\b/.test(output)
        ? "The test database isn't running. Start it with `npm run db:up`, then run the e2e tests again."
        : `Migrating the test database failed:\n${output}`,
    );
  }
}

main(process.argv[2]).catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
