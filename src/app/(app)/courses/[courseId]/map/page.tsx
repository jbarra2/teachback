import type { Metadata } from "next";
import { EmptyState } from "@/components/ui";

export const metadata: Metadata = { title: "Concept map · TeachBack" };

// Placeholder: the concept map arrives in T25.
export default function MapPage() {
  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Concept map</h1>
      <EmptyState
        title="Your map is coming soon"
        description="See which concepts you understand and which to review next."
      />
    </section>
  );
}
