import type { Metadata } from "next";
import { CourseLibrary } from "@/components/notes/course-library";

export const metadata: Metadata = { title: "Courses · TeachBack" };

export default function CoursesPage() {
  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Your courses</h1>
      <CourseLibrary />
    </section>
  );
}
