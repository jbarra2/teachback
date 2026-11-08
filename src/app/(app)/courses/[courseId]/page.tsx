import Link from "next/link";
import { CourseNotes } from "@/components/notes/course-notes";
import { PracticeWeakestLink } from "@/components/practice/practice-weakest-link";

export default async function CoursePage({
  params,
}: PageProps<"/courses/[courseId]">) {
  const { courseId } = await params;
  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Course</h1>
        <PracticeWeakestLink courseId={courseId} />
      </div>
      <nav aria-label="Course" className="flex gap-4 text-sm">
        <Link
          href={`/courses/${encodeURIComponent(courseId)}/practice`}
          className="text-primary underline"
        >
          Practice
        </Link>
        <Link
          href={`/courses/${encodeURIComponent(courseId)}/map`}
          className="text-primary underline"
        >
          Concept map
        </Link>
      </nav>
      <CourseNotes courseId={courseId} />
    </section>
  );
}
