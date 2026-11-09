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
      <h1 className="text-2xl font-semibold">Concept map</h1>
      {/* Shown only once the map loads: not above "Course not found" (T32). */}
      <ConceptMap
        courseId={courseId}
        actions={
          // On the right, as on the course page (in the map's column it would stretch).
          <div className="flex justify-end">
            <PracticeWeakestLink courseId={courseId} />
          </div>
        }
      />
    </section>
  );
}
