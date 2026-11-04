import { ApiError } from "@/lib/api/errors";
import { withApi } from "@/lib/api/with-api";
import { IdParams } from "@/lib/schemas";
import { listCourseConcepts } from "@/lib/services/courses";

/** GET /api/courses/{id}/concepts: the concepts of one of my courses, with my mastery. */
export const GET = withApi<{ id: string }>(async ({ user, params }) => {
  const { id } = IdParams.parse(params);
  const concepts = await listCourseConcepts(user!.id, id);
  if (!concepts) throw new ApiError("NOT_FOUND");
  return Response.json(concepts);
});
