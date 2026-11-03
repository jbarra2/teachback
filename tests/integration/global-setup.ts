// Runs once before the integration project (T07), in Vitest's main process: checks that .env.test
// is a local `_test` database and applies the migrations to it. It leaves process.env alone, because
// every project's workers inherit it, and the unit tests must not run with .env.test's values.
import { execFileSync } from "node:child_process";
import path from "node:path";
import { assertTestDatabase, readTestEnv } from "../helpers/test-db";

const root = path.resolve(import.meta.dirname, "../..");

export default function setup(): void {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...readTestEnv(),
    CHECKPOINT_DISABLE: "1",
  };
  try {
    assertTestDatabase(env);
  } catch (error) {
    throw printable((error as Error).message);
  }
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
        env,
        stdio: "pipe",
      },
    );
  } catch (error) {
    const output = String((error as { stderr?: unknown }).stderr ?? "").trim();
    // The guard passed, so DIRECT_URL is a plain local URL.
    const { host } = new URL(env.DIRECT_URL as string);
    if (/\bP1001\b/.test(output))
      throw printable(
        `The test database isn't running on ${host}. Start it with \`npm run db:up\`, then run the tests again.`,
      );
    throw printable(`Migrating the test database failed:\n${output}`);
  }
}

/**
 * An error whose stack is only its message. Vitest 5.0.5 crashes while source-mapping the stack of
 * a global setup error (Vite 8.3.5's module runner meets a Buffer where it expects a string), and
 * prints "TypeError: code.charCodeAt is not a function" instead of the message.
 */
function printable(message: string): Error {
  const error = new Error(message);
  error.stack = `Error: ${message}`;
  return error;
}
