import type { Metadata } from "next";
import { PracticeWeakestLink } from "@/components/practice/practice-weakest-link";
import { EmptyState } from "@/components/ui";

export const metadata: Metadata = { title: "Concept map · TeachBack" };

// Placeholder: the concept map arrives in T25.
export default async function MapPage({
  params,
}: PageProps<"/courses/[courseId]/map">) {
  const { courseId } = await params;
  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Concept map</h1>
        <PracticeWeakestLink courseId={courseId} />
      </div>
      <EmptyState
        title="Your map is coming soon"
        description="See which concepts you understand and which to review next."
      />
    </section>
  );
}
