import { ApiError } from "@/lib/api/errors";
import { withApi } from "@/lib/api/with-api";
import { IdParams } from "@/lib/schemas";
import { getDocumentStatus } from "@/lib/services/documents";

/**
 * GET /api/documents/{id}: a document's processing status and how many concepts it has. Anyone
 * else's is a 404. Still QUEUED or PROCESSING after 10 minutes reads as FAILED.
 */
export const GET = withApi<{ id: string }>(async ({ user, params }) => {
  const { id } = IdParams.parse(params);
  const document = await getDocumentStatus(user.id, id);
  if (!document) throw new ApiError("NOT_FOUND");
  return Response.json(document);
});
