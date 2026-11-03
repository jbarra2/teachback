import Link from "next/link";
import { EmptyState } from "@/components/ui";

// Placeholder: the course's notes and concepts arrive in T15.
export default async function CoursePage({
  params,
}: PageProps<"/courses/[courseId]">) {
  const { courseId } = await params;
  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Course</h1>
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
      <EmptyState
        title="No notes yet"
        description="Upload lecture notes for this course to see its concepts here."
      />
    </section>
  );
}
