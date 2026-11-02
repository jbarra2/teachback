import { ApiReference } from "@scalar/nextjs-api-reference";
import {
  apiDocsEnabled,
  SCALAR_CONFIG,
  ScalarTagError,
  withIntegrity,
} from "@/lib/api/api-docs";
import { ApiError } from "@/lib/api/errors";
import { withApi } from "@/lib/api/with-api";

// Decided on each request: never prerendered at build, where the flag would be read once.
export const dynamic = "force-dynamic";

const renderReference = ApiReference(SCALAR_CONFIG);

/** GET /api/docs: the Scalar API reference for openapi.yaml, its script checked by hash. */
export const GET = withApi(
  async () => {
    if (!apiDocsEnabled()) throw new ApiError("NOT_FOUND");
    const page = renderReference();
    const html = withIntegrity(await page.text());
    // Fails closed (a 500 with a request id) rather than serve a script the hash doesn't cover.
    if (html === null) throw new ScalarTagError();
    return new Response(html, { status: page.status, headers: page.headers });
  },
  { auth: false },
);
