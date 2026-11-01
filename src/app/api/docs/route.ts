import { ApiReference } from "@scalar/nextjs-api-reference";
import {
  apiDocsEnabled,
  internalError,
  notFound,
  SCALAR_CONFIG,
  withIntegrity,
} from "@/lib/api/api-docs";

// Decided on each request: never prerendered at build, where the flag would be read once.
export const dynamic = "force-dynamic";

const renderReference = ApiReference(SCALAR_CONFIG);

/** GET /api/docs: the Scalar API reference for openapi.yaml, its script checked by hash. */
export async function GET(): Promise<Response> {
  if (!apiDocsEnabled()) return notFound();
  const page = renderReference();
  const html = withIntegrity(await page.text());
  if (html === null) return internalError();
  return new Response(html, { status: page.status, headers: page.headers });
}
