import Link from "next/link";
import { tapLink } from "@/components/ui";
import { CourseNotes } from "@/components/notes/course-notes";
import { PracticeWeakestLink } from "@/components/practice/practice-weakest-link";

export default async function CoursePage({
  params,
}: PageProps<"/courses/[courseId]">) {
  const { courseId } = await params;
  const id = encodeURIComponent(courseId);
  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Course</h1>
      {/* Shown only once the course loads: not above "Course not found" (T32). */}
      <CourseNotes
        courseId={courseId}
        actions={
          <div className="flex flex-wrap items-center justify-between gap-4">
            <nav aria-label="Course" className="flex gap-4 text-sm">
              <Link href={`/courses/${id}/practice`} className={tapLink}>
                Practice
              </Link>
              <Link href={`/courses/${id}/map`} className={tapLink}>
                Concept map
              </Link>
            </nav>
            <PracticeWeakestLink courseId={courseId} />
          </div>
        }
      />
    </section>
  );
}
