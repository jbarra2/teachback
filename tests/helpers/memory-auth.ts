// The app's real Better Auth config (src/lib/auth-config.ts) on Better Auth's in-memory adapter, for
// unit tests that need a working auth instance without PostgreSQL. T07 repeats the flows on Postgres:
// the memory adapter enforces no unique indexes and clones its data for each transaction.
import { memoryAdapter } from "better-auth/adapters/memory";
import { createAuth } from "@/lib/auth-config";

export const TEST_APP = "https://teachback.example.test";
export const TEST_SECRET = "a-random-test-secret-that-is-long-enough-0123";

export type MemoryStore = Record<string, Record<string, unknown>[]>;

export function memoryAuth(env: Record<string, string> = {}) {
  const store: MemoryStore = {
    user: [],
    session: [],
    account: [],
    verification: [],
    rateLimit: [],
  };
  const auth = createAuth(memoryAdapter(store), {
    BETTER_AUTH_SECRET: TEST_SECRET,
    BETTER_AUTH_URL: TEST_APP,
    ...env,
  });
  return { auth, store };
}
