// Security headers (T14, PLAN §4, TESTING §8). One list for every response: pages get them from
// src/proxy.ts, API routes from withApi, and Next's static files from next.config.ts. Each kind
// of response also gets its own Content-Security-Policy, built here.

type Env = Record<string, string | undefined>;

/** The headers every response carries. HSTS only in production: locally the app runs on http. */
export function securityHeaders(env: Env = process.env): [string, string][] {
  const headers: [string, string][] = [
    ["X-Content-Type-Options", "nosniff"],
    ["Referrer-Policy", "strict-origin-when-cross-origin"],
    [
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
    ],
    // For browsers that predate CSP's frame-ancestors.
    ["X-Frame-Options", "DENY"],
  ];
  if (env.NODE_ENV === "production")
    headers.push([
      "Strict-Transport-Security",
      "max-age=63072000; includeSubDomains",
    ]);
  return headers;
}

/** Sets each security header, replacing any value already there. */
export function applySecurityHeaders(
  headers: Headers,
  env: Env = process.env,
): void {
  for (const [name, value] of securityHeaders(env)) headers.set(name, value);
}

/** 16 random bytes, base64: a fresh CSP nonce for one response. */
export function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64");
}

const join = (directives: string[]) => directives.join("; ");

/**
 * The pages' policy, following the Next.js CSP guide: scripts run only with this response's nonce
 * (Next tags its own) or when loaded by one that has it ('strict-dynamic'). Development adds
 * 'unsafe-eval', which React uses there for error stacks.
 */
export function pageCsp(nonce: string, env: Env = process.env): string {
  const production = env.NODE_ENV === "production";
  const scripts = ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'"];
  if (env.NODE_ENV === "development") scripts.push("'unsafe-eval'");
  const directives = [
    "default-src 'self'",
    `script-src ${scripts.join(" ")}`,
    // React and the concept map set style attributes, which a nonce can't cover. Styles can't run
    // code; scripts stay nonce-only.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];
  if (production) directives.push("upgrade-insecure-requests");
  return join(directives);
}

/** JSON and redirects load nothing, and nothing may frame them. */
export const API_CSP = join([
  "default-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'none'",
]);

/** One https file, nothing a CSP would read as a wildcard or a second source. */
const BUNDLE_URL = /^https:\/\/[a-z0-9.-]+\/[^\s;,'"*]*[^\s;,'"*/]$/;

/**
 * /api/docs only: the pinned Scalar bundle (exact URL, checked by hash in the page) and its inline
 * start-up script by nonce. Scalar injects its own styles, so they need 'unsafe-inline'. The
 * reference fetches only /api/openapi.
 */
export function docsCsp(nonce: string, bundleUrl: string): string {
  if (!BUNDLE_URL.test(bundleUrl))
    throw new Error("The docs bundle must be one exact https file URL.");
  return join([
    "default-src 'none'",
    `script-src 'nonce-${nonce}' ${bundleUrl}`,
    "style-src 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ]);
}
