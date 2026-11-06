import { ApiReference } from "@scalar/nextjs-api-reference";
import {
  apiDocsEnabled,
  SCALAR_BUNDLE_URL,
  SCALAR_CONFIG,
  ScalarTagError,
  withIntegrity,
} from "@/lib/api/api-docs";
import { ApiError } from "@/lib/api/errors";
import { createNonce, docsCsp } from "@/lib/api/security-headers";
import { withApi } from "@/lib/api/with-api";

// Decided on each request: never prerendered at build, where the flag would be read once.
export const dynamic = "force-dynamic";

/**
 * GET /api/docs: the Scalar API reference for openapi.yaml, its script checked by hash. The page
 * has its own CSP (T14): the pinned bundle plus scripts carrying this response's nonce.
 */
export const GET = withApi(
  async () => {
    if (!apiDocsEnabled()) throw new ApiError("NOT_FOUND");
    const nonce = createNonce();
    const page = ApiReference({ ...SCALAR_CONFIG, nonce })();
    const html = withIntegrity(await page.text(), nonce);
    // Fails closed (a 500 with a request id) rather than serve a script the hash doesn't cover.
    if (html === null) throw new ScalarTagError();
    const headers = new Headers(page.headers);
    headers.set("Content-Security-Policy", docsCsp(nonce, SCALAR_BUNDLE_URL));
    return new Response(html, { status: page.status, headers });
  },
  { auth: false },
);
