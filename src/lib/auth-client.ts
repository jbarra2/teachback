// The browser's client for the auth endpoints the app allows (T15 wires the forms to it): sign-up,
// sign-in, sign-out and the session. Always this page's own origin, never a URL from the environment,
// so the session cookie can't be sent to another host. Sign-up doesn't sign in (autoSignIn is off):
// call signIn.email after it succeeds.
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  baseURL: typeof window === "undefined" ? undefined : window.location.origin,
  basePath: "/api/auth",
});
