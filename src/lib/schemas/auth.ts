// Account requests, for the auth route (T06) and the sign-in and sign-up forms (T15). Better Auth's
// own sign-up schema accepts any extra field and stores some of them (an `image` of any size), and
// caps nothing, so the auth route checks bodies with these first and passes on only these values.
import { z } from "zod";
import { LIMITS, text } from "./common";

const Email = z
  .string()
  .trim()
  .toLowerCase()
  .max(LIMITS.email, `Must be at most ${LIMITS.email} characters.`)
  .pipe(z.email("Must be a valid email address."));

// Never trimmed: spaces are part of a password. Counted like Better Auth counts (UTF-16 units).
const Password = z
  .string()
  .min(LIMITS.passwordMin, `Must be at least ${LIMITS.passwordMin} characters.`)
  .max(LIMITS.passwordMax, `Must be at most ${LIMITS.passwordMax} characters.`);

export const SignUpBody = z
  .object({
    name: text(LIMITS.userName),
    email: Email,
    password: Password,
    rememberMe: z.boolean().optional(),
  })
  .strict();

export const SignInBody = z
  .object({
    email: Email,
    password: z
      .string()
      .min(1, "Can't be empty.")
      .max(
        LIMITS.passwordMax,
        `Must be at most ${LIMITS.passwordMax} characters.`,
      ),
    rememberMe: z.boolean().optional(),
  })
  .strict();

/**
 * Where to go after signing in: `next` when it resolves to this origin, else /courses. A string
 * check ("starts with one /") isn't enough: URL parsing strips tabs and newlines and reads `\` as `/`,
 * so "/\t/evil.example" and "/\evil.example" both become "//evil.example", another site.
 */
export function safeNextPath(
  next: string | null | undefined,
  origin: string,
): string {
  const fallback = "/courses";
  if (!next) return fallback;
  let url: URL;
  try {
    url = new URL(next, origin);
  } catch {
    return fallback;
  }
  if (url.origin !== new URL(origin).origin) return fallback;
  // Checked again as the string that's returned, resolved the way a browser resolves a redirect:
  // dot segments are removed after the origin is fixed, so "/.//evil.example" parses as this origin
  // yet comes out as "//evil.example", another site.
  const path = url.pathname + url.search + url.hash;
  if (new URL(path, origin).origin !== new URL(origin).origin) return fallback;
  return path;
}
