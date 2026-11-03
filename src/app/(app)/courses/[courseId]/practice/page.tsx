import type { Metadata } from "next";
import { ConceptPicker } from "@/components/practice/concept-picker";
import { PracticeSession } from "@/components/practice/practice-session";

export const metadata: Metadata = { title: "Practice · TeachBack" };

export default async function PracticePage({
  params,
  searchParams,
}: PageProps<"/courses/[courseId]/practice">) {
  const { courseId } = await params;
  const { concept } = await searchParams;
  // ?concept=a&concept=b arrives as an array; take the first.
  const conceptId = Array.isArray(concept) ? concept[0] : concept;
  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Practice</h1>
      {conceptId ? (
        // A new concept starts a fresh session instead of reusing the old one's state.
        <PracticeSession
          key={conceptId}
          courseId={courseId}
          conceptId={conceptId}
        />
      ) : (
        <ConceptPicker courseId={courseId} />
      )}
    </section>
  );
}
