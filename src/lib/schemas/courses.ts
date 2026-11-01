import { z } from "zod";
import { LIMITS, text } from "./common";

/** POST /api/courses */
export const CreateCourseBody = z
  .object({ name: text(LIMITS.courseName) })
  .strict();
