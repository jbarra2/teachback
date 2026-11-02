import Link from "next/link";
import { EmptyState, cn, focusRing } from "@/components/ui";

export function NotFoundMessage() {
  return (
    <EmptyState
      title="Page not found"
      description="We couldn't find that page. It may have moved, or you may not have access to it."
      action={
        <Link
          href="/courses"
          className={cn(
            "rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground",
            focusRing,
          )}
        >
          Back to my courses
        </Link>
      }
    />
  );
}
