import { withApi } from "@/lib/api/with-api";
import { CreateCourseBody } from "@/lib/schemas";
import { createCourse, listCourses } from "@/lib/services/courses";

/** GET /api/courses: my courses, newest first. */
export const GET = withApi(async ({ user }) =>
  Response.json(await listCourses(user.id)),
);

/** POST /api/courses: create a course. The owner is the session's user, never the body's. */
export const POST = withApi(async ({ user, json }) => {
  const { name } = CreateCourseBody.parse(await json());
  return Response.json(await createCourse(user.id, name), { status: 201 });
});
