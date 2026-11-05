"use client";
// Sign-in, sign-up and sign-out through Better Auth's client (src/lib/auth-client.ts). Each returns
// a message to show, or nothing on success. Messages are fixed text picked by status, so nothing the
// server or network sends is shown as is.
import { authClient } from "@/lib/auth-client";
import { GENERIC_MESSAGE, NETWORK_MESSAGE } from "@/lib/api-client/errors";
import type { LoginValues, SignupValues } from "./validation";

export const INVALID_LOGIN = "Invalid email or password.";
/** Better Auth's own rate-limit message. */
export const RATE_LIMITED = "Too many requests. Please try again later.";
export const CHECK_DETAILS = "Check your details and try again.";
// Sign-up answers the same for a new and an existing email (T06), so only sign-in can fail here.
export const SIGNUP_LOGIN_FAILED =
  "We couldn't sign you in. If you already have an account, log in instead.";

type AuthResult = { error?: { status: number } | null };

function messageFor(status: number): string {
  if (status === 401) return INVALID_LOGIN;
  if (status === 429) return RATE_LIMITED;
  if (status === 400) return CHECK_DETAILS;
  return GENERIC_MESSAGE;
}

/** The message for a call's error, or undefined when it succeeded. */
async function attempt(
  call: () => Promise<AuthResult>,
): Promise<{ status: number } | undefined> {
  let result: AuthResult;
  try {
    result = await call();
  } catch {
    return { status: 0 };
  }
  return result.error ?? undefined;
}

function toMessage(error: { status: number }): string {
  return error.status === 0 ? NETWORK_MESSAGE : messageFor(error.status);
}

export async function logIn({
  email,
  password,
}: LoginValues): Promise<string | undefined> {
  const error = await attempt(() =>
    authClient.signIn.email({ email: email.trim(), password }),
  );
  return error && toMessage(error);
}

/** Creates the account, then signs in: sign-up alone signs no one in (autoSignIn is off). */
export async function signUp({
  name,
  email,
  password,
}: SignupValues): Promise<string | undefined> {
  const created = await attempt(() =>
    authClient.signUp.email({
      name: name.trim(),
      email: email.trim(),
      password,
    }),
  );
  if (created) return toMessage(created);
  const signedIn = await attempt(() =>
    authClient.signIn.email({ email: email.trim(), password }),
  );
  if (!signedIn) return undefined;
  return signedIn.status === 401 ? SIGNUP_LOGIN_FAILED : toMessage(signedIn);
}

export async function signOut(): Promise<string | undefined> {
  const error = await attempt(() => authClient.signOut());
  return error && toMessage(error);
}
