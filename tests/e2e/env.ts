// Where the e2e run points (T29). The app runs under `next dev` on its own port with .env.test's
// values, so it only ever sees the local `_test` database and the fake AI provider. The lead chose
// dev over a production build: production refuses .env.test's public secret and http URL, and
// that guard stays as it is (comment on #29).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";

// Playwright loads these files as CommonJS, so no import.meta here.
const root = path.resolve(__dirname, "../..");

export const PORT = 3100;
export const BASE_URL = `http://127.0.0.1:${PORT}`;

/**
 * The header a host's proxy would set to the client's IP. Each test client sends its own address,
 * so Better Auth's sign-in limiter (3 per 10 s per IP) stays on but counts each client separately.
 */
export const IP_HEADER = "x-e2e-client-ip";

/** Every value the dev server and the setup get. They replace anything the shell or .env set. */
export function e2eEnv(): Record<string, string> {
  const testEnv = parseEnv(readFileSync(path.join(root, ".env.test"), "utf8"));
  return {
    ...(testEnv as Record<string, string>),
    BETTER_AUTH_URL: BASE_URL,
    TRUSTED_IP_HEADER: IP_HEADER,
    AI_PROVIDER: "fake",
    AI_FAKE_FAILURE: "",
    CHECKPOINT_DISABLE: "1",
    NEXT_TELEMETRY_DISABLED: "1",
  };
}

/**
 * Runs a database step from prepare-db.ts under tsx and throws with its message if it refuses or
 * fails. "check" only runs the `_test` guard; "prepare" runs the guard, then migrates and resets.
 */
export function runDbStep(step: "check" | "prepare"): void {
  try {
    execFileSync(
      process.execPath,
      [
        path.join(root, "node_modules/tsx/dist/cli.mjs"),
        path.join(root, "tests/e2e/prepare-db.ts"),
        step,
      ],
      { cwd: root, stdio: "pipe" },
    );
  } catch (error) {
    const output = String((error as { stderr?: unknown }).stderr ?? "").trim();
    throw new Error(output || `The e2e database step "${step}" failed.`);
  }
}

/** Saved sign-ins for the two users global setup creates. */
export const STORAGE = {
  a: "test-results/.auth/user-a.json",
  b: "test-results/.auth/user-b.json",
} as const;

/** One fixed client IP per saved user, so their sign-in limits never collide. */
export const IPS = { a: "10.29.0.1", b: "10.29.0.2" } as const;

/** A fresh client IP for a test that signs up its own user. */
export function freshIp(): string {
  const byte = () => Math.floor(Math.random() * 254) + 1;
  return `10.${byte()}.${byte()}.${byte()}`;
}

/** An email no earlier run or test has used, so every run can sign up from scratch. */
export function freshEmail(label: string): string {
  return `e2e-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
}

export const PASSWORD = "e2e-password-123";
