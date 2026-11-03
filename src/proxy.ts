// Runs before every page (PLAN §4; Next 16's proxy runs on Node). Signed-out visitors to app pages go
// to /login?next=<where they were going>; signed-in users on /login or /signup go to /courses. The
// session is checked against the database, not just the cookie's presence: a stale cookie would
// otherwise bounce between /login and /courses. API routes are left to withApi, which enforces auth.
// T14 adds the CSP nonce and security headers here.
import { NextResponse, type NextRequest } from "next/server";
import { readSession, type ApiSession } from "@/lib/api/session";
import { assertAuthEnvReady, readAuthEnv } from "@/lib/auth-env";
import { safeNextPath } from "@/lib/schemas";

const AUTH_PAGES = new Set(["/login", "/signup"]);
const PUBLIC_PAGES = new Set(["/"]);

/** The app's origin from configuration, like withApi: never the Host a request names. */
function appOrigin(request: NextRequest): string {
  return readAuthEnv().appOrigin ?? request.nextUrl.origin;
}

function redirect(
  request: NextRequest,
  path: string,
  next?: string,
): NextResponse {
  const url = new URL(path, appOrigin(request));
  if (next) url.searchParams.set("next", next);
  return NextResponse.redirect(url);
}

function pass(session: ApiSession | null): NextResponse {
  const response = NextResponse.next();
  for (const cookie of session?.setCookies ?? [])
    response.headers.append("set-cookie", cookie);
  return response;
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname, search } = request.nextUrl;
  if (PUBLIC_PAGES.has(pathname)) return NextResponse.next();

  if (AUTH_PAGES.has(pathname)) {
    // The sign-in pages stay reachable even if the session can't be read.
    const session = await readSession(request).catch(() => null);
    return session ? redirect(request, "/courses") : pass(null);
  }

  assertAuthEnvReady();
  const session = await readSession(request);
  if (session) return pass(session);
  return redirect(
    request,
    "/login",
    safeNextPath(pathname + search, appOrigin(request)),
  );
}

export const config = {
  // Pages only: not API routes, Next's own files, or the favicon.
  matcher: ["/((?!api/|_next/static|_next/image|favicon.ico).*)"],
};
