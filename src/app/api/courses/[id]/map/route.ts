import { ApiError } from "@/lib/api/errors";
import { withApi } from "@/lib/api/with-api";
import { IdParams } from "@/lib/schemas";
import { getCourseMap } from "@/lib/services/map";

/** GET /api/courses/{id}/map: my course's concepts with my mastery, and how they relate. */
export const GET = withApi<{ id: string }>(async ({ user, params }) => {
  const { id } = IdParams.parse(params);
  const courseMap = await getCourseMap(user.id, id);
  if (!courseMap) throw new ApiError("NOT_FOUND");
  return Response.json(courseMap);
});
