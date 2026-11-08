import Link from "next/link";
import { MasteryBadge, textLink, cn } from "@/components/ui";
import type { CourseConcept } from "@/lib/api-client";

/** The concepts found in a course's notes, each linking to practice for it. */
export function ConceptList({
  courseId,
  concepts,
}: {
  courseId: string;
  concepts: CourseConcept[];
}) {
  if (concepts.length === 0)
    return (
      <p className="text-sm text-muted">
        No concepts yet. They appear here once your notes are processed.
      </p>
    );
  return (
    <ul aria-label="Concepts" className="flex flex-col gap-3">
      {concepts.map((concept) => (
        <li
          key={concept.id}
          className="flex flex-col gap-1 rounded-lg border border-border p-3"
        >
          <div className="flex items-center justify-between gap-3">
            <Link
              href={`/courses/${encodeURIComponent(courseId)}/practice?concept=${encodeURIComponent(concept.id)}`}
              className={cn("font-medium", textLink)}
            >
              {concept.name}
            </Link>
            <MasteryBadge state={concept.state} />
          </div>
          <p className="text-sm text-muted">{concept.summary}</p>
        </li>
      ))}
    </ul>
  );
}
