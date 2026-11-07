import { ApiError } from "@/lib/api/errors";
import { withApi } from "@/lib/api/with-api";
import { IdParams } from "@/lib/schemas";
import { getCourse } from "@/lib/services/courses";

/** GET /api/courses/{id}: one of my courses with its documents. Anyone else's is a 404. */
export const GET = withApi<{ id: string }>(async ({ user, params }) => {
  const { id } = IdParams.parse(params);
  const course = await getCourse(user.id, id);
  if (!course) throw new ApiError("NOT_FOUND");
  return Response.json(course);
});
