// The secret Better Auth signs sessions and tokens with (src/lib/auth.ts).

// What Better Auth signs with when no secret is set. Outside production it only warns.
const BETTER_AUTH_DEFAULT_SECRET = "better-auth-secret-12345678901234567890";
const MIN_SECRET_LENGTH = 32;

/**
 * BETTER_AUTH_SECRET, refused unless it's a real secret: not missing, not the .env.example
 * placeholder, not Better Auth's public default, and at least 32 characters. The errors never
 * include the value.
 */
export function readAuthSecret(
  env: Record<string, string | undefined> = process.env,
): string {
  // Better Auth prefers this rotation list over `secret`, which would skip the checks below.
  if (env.BETTER_AUTH_SECRETS !== undefined)
    throw new Error(
      "BETTER_AUTH_SECRETS isn't supported. Set BETTER_AUTH_SECRET only.",
    );
  const secret = env.BETTER_AUTH_SECRET?.trim() ?? "";
  // Setup generates a secret only when the line is missing, empty or the placeholder, so the other
  // refusals say to delete the line first.
  if (secret === "" || secret === "replace-me")
    throw new Error(
      "BETTER_AUTH_SECRET is not set. Run `npm run setup`, which generates one in .env.",
    );
  if (secret === BETTER_AUTH_DEFAULT_SECRET)
    throw new Error(
      "BETTER_AUTH_SECRET is Better Auth's public example value. Delete that line from .env and run `npm run setup` to generate a real one.",
    );
  if (secret.length < MIN_SECRET_LENGTH)
    throw new Error(
      `BETTER_AUTH_SECRET must be at least ${MIN_SECRET_LENGTH} characters. Delete that line from .env and run \`npm run setup\` to generate one.`,
    );
  return secret;
}
