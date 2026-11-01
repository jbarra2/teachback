import { readFile } from "node:fs/promises";
import path from "node:path";
import { apiDocsEnabled, internalError, notFound } from "@/lib/api/api-docs";

// Decided on each request: never prerendered at build, where the flag would be read once.
export const dynamic = "force-dynamic";

// next.config.ts traces this file into the server build (outputFileTracingIncludes).
const SPEC_FILE = path.join(process.cwd(), "openapi", "openapi.yaml");

/** GET /api/openapi: openapi.yaml as it is, read on each request so edits show without a restart. */
export async function GET(): Promise<Response> {
  if (!apiDocsEnabled()) return notFound();
  let spec: string;
  try {
    spec = await readFile(SPEC_FILE, "utf8");
  } catch {
    return internalError();
  }
  return new Response(spec, {
    headers: {
      "Content-Type": "application/yaml; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
