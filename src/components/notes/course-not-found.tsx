// What the course, practice and map pages show for a course they can't show (T32). An unknown id,
// a malformed one and another student's course all look the same: not found.
import Link from "next/link";
import { EmptyState, tapLink } from "@/components/ui";
import { ApiError } from "@/lib/api-client";

/** True when the API said the course doesn't exist for this user (404) or the id is malformed. */
export function isCourseMissing(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    (error.code === "NOT_FOUND" || error.code === "VALIDATION_ERROR")
  );
}

export function CourseNotFound() {
  return (
    <EmptyState
      title="Course not found"
      description="It may have been removed, or the link is wrong."
      action={
        <Link href="/courses" className={tapLink}>
          Back to your courses
        </Link>
      }
    />
  );
}
