import { readFile } from "node:fs/promises";
import path from "node:path";
import { apiDocsEnabled } from "@/lib/api/api-docs";
import { ApiError } from "@/lib/api/errors";
import { withApi } from "@/lib/api/with-api";

// Decided on each request: never prerendered at build, where the flag would be read once.
export const dynamic = "force-dynamic";

// next.config.ts traces this file into the server build (outputFileTracingIncludes).
const SPEC_FILE = path.join(process.cwd(), "openapi", "openapi.yaml");

/** GET /api/openapi: openapi.yaml as it is, read on each request so edits show without a restart. */
export const GET = withApi(
  async () => {
    if (!apiDocsEnabled()) throw new ApiError("NOT_FOUND");
    // A read failure is a 500 with a request id (withApi), never the file system's message.
    const spec = await readFile(SPEC_FILE, "utf8");
    return new Response(spec, {
      headers: {
        "Content-Type": "application/yaml; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
      },
    });
  },
  { auth: false },
);
