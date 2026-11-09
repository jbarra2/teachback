// The "Practice weakest" button (T26), on the course page and the concept map. A link, so it
// works before any JavaScript loads.
import Link from "next/link";
import { cn, focusRing } from "@/components/ui";

export function PracticeWeakestLink({ courseId }: { courseId: string }) {
  return (
    <Link
      href={`/courses/${encodeURIComponent(courseId)}/practice/weakest`}
      className={cn(
        // min-h-11: at least 44 px tall, easy to tap on a phone (T32).
        "inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90",
        focusRing,
      )}
    >
      Practice weakest
    </Link>
  );
}
