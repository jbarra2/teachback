// GET /api/openapi and GET /api/docs (PLAN §7): public, and only there when API_DOCS_ENABLED=true.
// Both are wrapped in withApi({ auth: false }), which owns their error responses and request ids.
import type { ApiReferenceConfiguration } from "@scalar/nextjs-api-reference";

/** Exactly "true" turns the docs on. Anything else, unset included, leaves them off. */
export function apiDocsEnabled(): boolean {
  return process.env.API_DOCS_ENABLED === "true";
}

/** Scalar's page had no script tag to pin, so it can't be served with the integrity check. */
export class ScalarTagError extends Error {
  override name = "ScalarTagError";
}

/**
 * Scalar's viewer, one reviewed release from jsDelivr. Left to itself, Scalar loads whatever
 * release is newest on every visit, and that script runs on this origin, where it can call the
 * API as the signed-in user. Bump the URL and the hash together, deliberately.
 */
export const SCALAR_BUNDLE_URL =
  "https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.76.0/dist/browser/standalone.js";

/** sha384 of that file. The browser refuses the script if the CDN serves anything else. */
export const SCALAR_BUNDLE_INTEGRITY =
  "sha384-oH1C0RwqcwbVXkC+r8A+4qRoyEUQdtxAzOwumkxZtQBBcsy61FOoPt7B50OVJYYQ";

// Any absolute or protocol-relative URL: a script, stylesheet, import() or CSS url() elsewhere.
const ABSOLUTE_URL = /(?:[a-z][a-z0-9+.-]*:)?\/\/[^\s"'`<>()]+/gi;

/**
 * Adds the integrity check to the page's script tag (Scalar's renderer has no option for it),
 * keeping any attributes after `src` (a CSP nonce, T14). Returns null, so the route fails closed,
 * unless the pinned bundle is the page's only absolute URL and its tag appears exactly once: a
 * later Scalar release that loads anything else is refused rather than served unchecked.
 *
 * `nonce` is this response's CSP nonce, which the server made. It's base64, so it can contain
 * "//": it's left out of the URL scan, or about one page in 200 would be refused.
 */
export function withIntegrity(html: string, nonce?: string): string | null {
  const scanned = nonce ? html.split(nonce).join("") : html;
  const urls = new Set(scanned.match(ABSOLUTE_URL));
  if (urls.size !== 1 || !urls.has(SCALAR_BUNDLE_URL)) return null;
  const tag = `<script src="${SCALAR_BUNDLE_URL}"`;
  if (html.split(tag).length !== 2) return null;
  return html.replace(
    tag,
    () =>
      `${tag} integrity="${SCALAR_BUNDLE_INTEGRITY}" crossorigin="anonymous"`,
  );
}

export const SCALAR_CONFIG = {
  url: "/api/openapi",
  cdn: SCALAR_BUNDLE_URL,
  pageTitle: "TeachBack API",
  // Nothing goes to Scalar's servers: no usage data, AI agent, MCP, developer toolbar or web fonts.
  // The toolbar and MCP settings also keep Scalar's "Explore" modal off, which would load an
  // unpinned script from app.cal.com that the integrity check doesn't cover.
  telemetry: false,
  agent: { disabled: true },
  mcp: { disabled: true },
  showDeveloperTools: "never",
  withDefaultFonts: false,
} satisfies Partial<ApiReferenceConfiguration>;
