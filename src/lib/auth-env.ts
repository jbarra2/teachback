// Auth settings that are fine on a laptop and wrong in production. They're checked on each request
// (withApi, the auth route, src/proxy.ts), not at import: CI builds with NODE_ENV=production and
// .env.test's values, and a refusal at import would fail that build. Messages name the variable,
// never its value.

type Env = Record<string, string | undefined>;

/** The secret .env.test commits. It's public, so it must never sign production sessions. */
export const PUBLIC_TEST_SECRET = "test-secret-for-local-and-ci-tests-only";

/**
 * The header Better Auth reads the client's IP from. The auth route deletes any copy a client sends
 * and sets it from TRUSTED_IP_HEADER, the one header the host vouches for. Better Auth would
 * otherwise trust a single X-Forwarded-For value, which any client can rotate to dodge rate limits.
 */
export const CLIENT_IP_HEADER = "x-teachback-client-ip";

const HEADER_NAME = /^[a-z0-9-]+$/;

const value = (env: Env, name: string) => env[name]?.trim() || undefined;

function originOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

export interface AuthEnv {
  baseURL: string | undefined;
  /** The app's own origin, for the CSRF check. */
  appOrigin: string | undefined;
  /** The one header the hosting platform sets to the client's IP (e.g. x-real-ip on Vercel). */
  trustedIpHeader: string | undefined;
  /** Secure cookies with the __Secure- prefix: true when the base URL is https. */
  secureCookies: boolean;
}

export function readAuthEnv(env: Env = process.env): AuthEnv {
  const baseURL = value(env, "BETTER_AUTH_URL");
  return {
    baseURL,
    appOrigin: originOf(baseURL),
    trustedIpHeader: value(env, "TRUSTED_IP_HEADER")?.toLowerCase(),
    secureCookies: baseURL?.startsWith("https://") ?? false,
  };
}

export function authEnvProblems(env: Env = process.env): string[] {
  const problems: string[] = [];
  // Better Auth reads these itself, whatever its config says.
  if (value(env, "BETTER_AUTH_TELEMETRY"))
    problems.push(
      "BETTER_AUTH_TELEMETRY must not be set: it turns Better Auth's telemetry back on.",
    );
  if (value(env, "BETTER_AUTH_TRUSTED_ORIGINS"))
    problems.push(
      "BETTER_AUTH_TRUSTED_ORIGINS must not be set: it adds origins Better Auth trusts.",
    );
  if (readAuthEnv(env).trustedIpHeader === CLIENT_IP_HEADER)
    problems.push(
      "TRUSTED_IP_HEADER must not be the app's own internal header: clients could set it themselves.",
    );
  if (env.NODE_ENV !== "production") return problems;

  const { baseURL, trustedIpHeader } = readAuthEnv(env);
  if (!baseURL || !originOf(baseURL) || !baseURL.startsWith("https://"))
    problems.push("BETTER_AUTH_URL must be the app's https URL in production.");
  if (!trustedIpHeader || !HEADER_NAME.test(trustedIpHeader))
    problems.push(
      "TRUSTED_IP_HEADER must name the header your host sets to the client's IP, so a client can't pick the address rate limits count.",
    );
  if (value(env, "BETTER_AUTH_SECRET") === PUBLIC_TEST_SECRET)
    problems.push(
      "BETTER_AUTH_SECRET is the public test secret from .env.test.",
    );
  if (env.TEST !== undefined)
    problems.push(
      "TEST must not be set in production: Better Auth treats it as a test run.",
    );
  return problems;
}

export function assertAuthEnvReady(env: Env = process.env): void {
  const problems = authEnvProblems(env);
  if (problems.length > 0)
    throw new Error(`Auth isn't configured safely: ${problems.join(" ")}`);
}
