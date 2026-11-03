// The CSRF rule (PLAN §4): a state-changing request is refused when its Origin header is present and
// isn't the app's origin, or when the browser marks it Sec-Fetch-Site: cross-site. Requests with
// neither header (curl, Postman, tests) are allowed: CSRF needs a browser, and browsers send both.

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function isCrossSiteRequest(
  request: Request,
  appOrigin: string,
): boolean {
  if (SAFE_METHODS.has(request.method.toUpperCase())) return false;
  if (request.headers.get("sec-fetch-site") === "cross-site") return true;
  const origin = request.headers.get("origin");
  // An exact match on scheme, host and port. "null" (sandboxed frames, file:) never matches.
  return origin !== null && origin !== new URL(appOrigin).origin;
}
