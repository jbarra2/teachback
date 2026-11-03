// Request bodies with a size limit (PLAN §7: JSON body ≤ 64 KB). The limit is checked against
// Content-Length before anything is read, then enforced while reading, because a chunked body has
// no length and a client can send more than its Content-Length claims.
import { ApiError } from "./errors";

function invalid(message: string): ApiError {
  return new ApiError("VALIDATION_ERROR", undefined, {
    formErrors: [message],
    fieldErrors: {},
  });
}

const tooLarge = () => new ApiError("PAYLOAD_TOO_LARGE");

/** Refuses a Content-Length over the limit, or one that isn't a plain non-negative integer. */
export function checkContentLength(request: Request, maxBytes: number): void {
  const header = request.headers.get("content-length");
  if (header === null) return;
  if (!/^\d+$/.test(header)) throw invalid("Content-Length isn't valid.");
  if (Number(header) > maxBytes) throw tooLarge();
}

export async function readBodyBytes(
  request: Request,
  maxBytes: number,
): Promise<Uint8Array> {
  checkContentLength(request, maxBytes);
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      try {
        await reader.cancel();
      } catch {
        // A stream that fails to cancel is already broken; the 413 stands.
      }
      throw tooLarge();
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

/** True only for application/json itself (any case, with parameters), not lookalikes or +json types. */
function isJson(request: Request): boolean {
  const type = request.headers.get("content-type");
  return type?.split(";")[0].trim().toLowerCase() === "application/json";
}

export async function readJsonBody(
  request: Request,
  maxBytes: number,
  { optional = false }: { optional?: boolean } = {},
): Promise<unknown> {
  const bytes = await readBodyBytes(request, maxBytes);
  // Next gives every POST a body stream, so "no body" arrives as zero bytes, not as a null body.
  if (optional && bytes.byteLength === 0) return undefined;
  if (!isJson(request))
    throw invalid("The body must be JSON (Content-Type: application/json).");
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw invalid("The body isn't valid UTF-8.");
  }
  if (text.trim() === "") throw invalid("The body is empty.");
  try {
    return JSON.parse(text);
  } catch {
    throw invalid("The body isn't valid JSON.");
  }
}
