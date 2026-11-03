// Better Auth's configuration (PLAN §3), as a factory: src/lib/auth.ts builds the app's instance on
// PostgreSQL, and tests build the same config on Better Auth's in-memory adapter. Requests reach
// it only through src/app/api/auth/[...all]/route.ts (src/lib/api/auth-route.ts), which allows four
// endpoints, checks bodies and sizes first, and strips tokens from responses.
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { CLIENT_IP_HEADER, readAuthEnv } from "@/lib/auth-env";
import { readAuthSecret } from "@/lib/auth-secret";
import { log } from "@/lib/log";
import { LIMITS } from "@/lib/schemas";

export { CLIENT_IP_HEADER } from "@/lib/auth-env";

type Env = Record<string, string | undefined>;

export function authOptions(
  database: BetterAuthOptions["database"],
  env: Env = process.env,
) {
  const { baseURL, secureCookies } = readAuthEnv(env);
  return {
    secret: readAuthSecret(env),
    baseURL,
    database,
    emailAndPassword: {
      enabled: true,
      minPasswordLength: LIMITS.passwordMin,
      maxPasswordLength: LIMITS.passwordMax,
      // Sign-up answers the same for a new and an existing email, and signs no one in: T15's form
      // signs in as a second step. (The user's decision, so sign-up alone doesn't reveal accounts.)
      autoSignIn: false,
    },
    // Better Auth's defaults: 100 requests per 10 s per IP and path, 3 per 10 s on sign-in and
    // sign-up. On in every environment, and in the database so a serverless host keeps the counts.
    rateLimit: { enabled: true, storage: "database" },
    advanced: {
      // Explicit, because under NODE_ENV=test Better Auth would skip these checks.
      disableOriginCheck: false,
      disableCSRFCheck: false,
      useSecureCookies: secureCookies,
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax", path: "/" },
      ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] },
    },
    logger: {
      level: "warn",
      // Message only: Better Auth passes whole errors (queries, connection details) as extra args.
      log: (level, message) => {
        if (level === "error") log.error(message);
        else if (level === "warn") log.warn(message);
        else log.info(message);
      },
    },
    // Unexpected errors go back to withApi (a generic 500 with a request id) instead of being
    // printed whole by better-call.
    onAPIError: { throw: true },
    telemetry: { enabled: false },
  } satisfies BetterAuthOptions;
}

export function createAuth(
  database: BetterAuthOptions["database"],
  env: Env = process.env,
) {
  return betterAuth(authOptions(database, env));
}
