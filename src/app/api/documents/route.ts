import { readBodyBytes } from "@/lib/api/body";
import { ApiError } from "@/lib/api/errors";
import { withApi } from "@/lib/api/with-api";
import { IngestError } from "@/lib/ingest/errors";
import { LIMITS, UploadDocumentForm } from "@/lib/schemas";
import { uploadDocument } from "@/lib/services/documents";

const invalid = (message: string) =>
  new ApiError("VALIDATION_ERROR", undefined, {
    formErrors: [message],
    fieldErrors: {},
  });

/**
 * The multipart form as a plain object, read within the upload limit. A field sent twice is
 * refused: FormData.get() would see the first value and Object.fromEntries() the last, so a check
 * could pass on a different courseId from the one stored.
 */
async function readForm(request: Request): Promise<Record<string, unknown>> {
  const type = request.headers.get("content-type") ?? "";
  if (!/^multipart\/form-data\s*;/i.test(type))
    throw invalid("Send the upload as multipart/form-data.");
  const bytes = await readBodyBytes(request, LIMITS.uploadBytes);
  let form: FormData;
  try {
    form = await new Response(new Uint8Array(bytes), {
      headers: { "content-type": type },
    }).formData();
  } catch {
    throw invalid("The upload couldn't be read as a form.");
  }
  const fields: Record<string, unknown> = {};
  for (const [name, value] of form.entries()) {
    if (Object.hasOwn(fields, name)) throw invalid(`"${name}" was sent twice.`);
    fields[name] = value;
  }
  return fields;
}

/** An ingest problem as the contract's error: its status, its fixed message, and Retry-After. */
function toApiError(error: IngestError): ApiError {
  return new ApiError(error.code, error.message, undefined, {
    retryAfter: error.retryAfterSeconds,
  });
}

/**
 * POST /api/documents: save notes (a file or pasted text) to one of my courses and process them
 * after the response (202). A request with no Content-Length is refused before it's read.
 */
export const POST = withApi(
  async ({ request, user }) => {
    if (request.headers.get("content-length") === null)
      throw new ApiError("PAYLOAD_TOO_LARGE");
    const form = UploadDocumentForm.parse(await readForm(request));
    try {
      const document = await uploadDocument(user.id, form);
      if (!document) throw new ApiError("NOT_FOUND");
      return Response.json(
        { id: document.id, status: "QUEUED" },
        { status: 202 },
      );
    } catch (error) {
      if (error instanceof IngestError) throw toApiError(error);
      throw error;
    }
  },
  { rateLimit: "upload", maxBodyBytes: LIMITS.uploadBytes },
);
