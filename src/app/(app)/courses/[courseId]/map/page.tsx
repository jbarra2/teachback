import type { Metadata } from "next";
import { ConceptMap } from "@/components/map/concept-map";
import { PracticeWeakestLink } from "@/components/practice/practice-weakest-link";

export const metadata: Metadata = { title: "Concept map · TeachBack" };

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
      <ConceptMap courseId={courseId} />
    </section>
  );
}
