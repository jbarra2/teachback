import { ApiError } from "@/lib/api/errors";
import { withApi } from "@/lib/api/with-api";
import { IdParams } from "@/lib/schemas";
import { getNextConcept } from "@/lib/services/map";

/** GET /api/courses/{id}/next-concept: what I should practise next in my course, or null. */
export const GET = withApi<{ id: string }>(async ({ user, params }) => {
  const { id } = IdParams.parse(params);
  const result = await getNextConcept(user.id, id);
  if (!result) throw new ApiError("NOT_FOUND");
  return Response.json(result.concept);
});
