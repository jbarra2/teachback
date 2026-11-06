// Runs before every page (PLAN §4; Next 16's proxy runs on Node). Signed-out visitors to app pages go
// to /login?next=<where they were going>; signed-in users on /login or /signup go to /courses. The
// session is checked against the database, not just the cookie's presence: a stale cookie would
// otherwise bounce between /login and /courses. API routes are left to withApi, which enforces auth.
//
// Every page response also gets a fresh CSP nonce and the security headers (T14, following the
// Next.js CSP guide). Next reads the nonce from the request's CSP header while rendering and tags
// its own scripts with it, so the root layout renders each page per request.
import { NextResponse, type NextRequest } from "next/server";
import {
  applySecurityHeaders,
  createNonce,
  pageCsp,
} from "@/lib/api/security-headers";
import { readSession, type ApiSession } from "@/lib/api/session";
import { assertAuthEnvReady, readAuthEnv } from "@/lib/auth-env";
import { safeNextPath } from "@/lib/schemas";

const AUTH_PAGES = new Set(["/login", "/signup"]);
const PUBLIC_PAGES = new Set(["/"]);

/** The app's origin from configuration, like withApi: never the Host a request names. */
function appOrigin(request: NextRequest): string {
  return readAuthEnv().appOrigin ?? request.nextUrl.origin;
}

/** Sets the CSP and the security headers on a response this proxy sends. */
function secured(response: NextResponse, csp: string): NextResponse {
  response.headers.set("Content-Security-Policy", csp);
  applySecurityHeaders(response.headers);
  return response;
}

function redirect(
  request: NextRequest,
  csp: string,
  path: string,
  next?: string,
): NextResponse {
  const url = new URL(path, appOrigin(request));
  if (next) url.searchParams.set("next", next);
  return secured(NextResponse.redirect(url), csp);
}

/** Renders the page, handing Next this response's nonce and CSP (a client's own are replaced). */
function pass(
  request: NextRequest,
  nonce: string,
  csp: string,
  session: ApiSession | null,
): NextResponse {
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers } });
  const cookies = session?.setCookies ?? [];
  for (const cookie of cookies) response.headers.append("set-cookie", cookie);
  // A refreshed session cookie must never be stored by a cache and handed to someone else.
  if (cookies.length > 0)
    response.headers.set("Cache-Control", "private, no-store");
  return secured(response, csp);
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname, search } = request.nextUrl;
  const nonce = createNonce();
  const csp = pageCsp(nonce);
  if (PUBLIC_PAGES.has(pathname)) return pass(request, nonce, csp, null);

  if (AUTH_PAGES.has(pathname)) {
    // The sign-in pages stay reachable even if the session can't be read.
    const session = await readSession(request).catch(() => null);
    return session
      ? redirect(request, csp, "/courses")
      : pass(request, nonce, csp, null);
  }

  assertAuthEnvReady();
  const session = await readSession(request);
  if (session) return pass(request, nonce, csp, session);
  return redirect(
    request,
    csp,
    "/login",
    safeNextPath(pathname + search, appOrigin(request)),
  );
}

export const config = {
  // Pages only: not API routes, Next's own files, or the favicon.
  matcher: ["/((?!api/|_next/static|_next/image|favicon.ico).*)"],
};
