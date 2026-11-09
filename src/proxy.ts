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
import { log } from "@/lib/log";
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

/**
 * Outside production, a page opened under another name for this server opens the same path on the
 * configured origin. `npm run dev` prints http://127.0.0.1:3000 while BETTER_AUTH_URL says
 * localhost, and cookies and the Origin check only work on the configured one: without this, every
 * sign-up from 127.0.0.1 got a 403 (T32).
 *
 * - nextUrl doesn't name the host the browser used (Next builds it from its own settings), so the
 *   Host header is what tells. It only decides whether to answer this way; the target is built
 *   from configuration, with the path set as a path, so it can never be another site.
 * - It's a small page, not a Location redirect: Next rewrites a proxy redirect to its own
 *   "localhost" into a relative one, which sent the browser back to 127.0.0.1 in a loop.
 * - Only under `next dev` (NODE_ENV=development): production and any staging build are left to
 *   the host's own routing.
 */
function toConfiguredHost(
  request: NextRequest,
  csp: string,
): NextResponse | null {
  if (process.env.NODE_ENV !== "development") return null;
  const { appOrigin } = readAuthEnv();
  const host = request.headers.get("host");
  if (!appOrigin || !host) return null;
  const target = new URL(appOrigin);
  if (hostOf(target.protocol, host) === target.host) return null;
  target.pathname = request.nextUrl.pathname;
  target.search = request.nextUrl.search;
  const href = escapeHtml(target.href);
  const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=${href}"><title>TeachBack</title></head><body><p>Opening TeachBack at <a href="${href}">${href}</a></p></body></html>`;
  return secured(
    new NextResponse(page, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      },
    }),
    csp,
  );
}

/** A 503 page for when the session can't be checked (the database is down). Nothing private. */
function unavailable(csp: string): NextResponse {
  const page =
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1"><title>TeachBack</title>' +
    // The page CSP allows inline styles; nothing here comes from the request.
    "<style>body{font-family:system-ui,sans-serif;line-height:1.5;max-width:40rem;margin:4rem auto;padding:0 1rem}" +
    "@media (prefers-color-scheme:dark){body{background:#0a0a0a;color:#ededed}}</style></head>" +
    "<body><h1>TeachBack can't load right now</h1>" +
    "<p>Something on our side isn't working. Wait a moment, then reload the page.</p></body></html>";
  return secured(
    new NextResponse(page, {
      status: 503,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Retry-After": "30",
      },
    }),
    csp,
  );
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/** A Host header as URLs compare it (lower case, no default port), or null if it isn't one. */
function hostOf(protocol: string, host: string): string | null {
  try {
    const url = new URL(`${protocol}//${host}`);
    return url.username || url.password || url.pathname !== "/"
      ? null
      : url.host;
  } catch {
    return null;
  }
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
  const elsewhere = toConfiguredHost(request, csp);
  if (elsewhere) return elsewhere;
  if (PUBLIC_PAGES.has(pathname)) return pass(request, nonce, csp, null);

  if (AUTH_PAGES.has(pathname)) {
    // The sign-in pages stay reachable even if the session can't be read.
    const session = await readSession(request).catch(() => null);
    return session
      ? redirect(request, csp, "/courses")
      : pass(request, nonce, csp, null);
  }

  assertAuthEnvReady();
  let session: ApiSession | null;
  try {
    session = await readSession(request);
  } catch (error) {
    // Fails closed, with a page that says so instead of a blank 500 (T32: database down).
    log.error("Couldn't read the session for a page", {
      path: pathname,
      errorName: error instanceof Error ? error.name : typeof error,
    });
    return unavailable(csp);
  }
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
