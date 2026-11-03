import type { Metadata } from "next";
import { ConceptMap } from "@/components/map/concept-map";

export const metadata: Metadata = { title: "Concept map · TeachBack" };

export default async function MapPage({
  params,
}: PageProps<"/courses/[courseId]/map">) {
  const { courseId } = await params;
  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Concept map</h1>
      <ConceptMap courseId={courseId} />
    </section>
  );
}
