import type { Metadata } from "next";
import { EmptyState } from "@/components/ui";

export const metadata: Metadata = { title: "Courses · TeachBack" };

// Placeholder: the notes library and upload arrive in T15.
export default function CoursesPage() {
  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Your courses</h1>
      <EmptyState
        title="No courses yet"
        description="Create a course and upload your lecture notes to start practising."
      />
    </section>
  );
}
