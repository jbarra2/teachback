import type { Metadata } from "next";
import { EmptyState } from "@/components/ui";

export const metadata: Metadata = { title: "Practice · TeachBack" };

// Placeholder: the practice session arrives in T16.
export default function PracticePage() {
  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Practice</h1>
      <EmptyState
        title="Practice is coming soon"
        description="You'll explain a concept in your own words and get feedback grounded in your notes."
      />
    </section>
  );
}
