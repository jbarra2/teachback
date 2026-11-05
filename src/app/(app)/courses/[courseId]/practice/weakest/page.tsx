import type { Metadata } from "next";
import { WeakestPractice } from "@/components/practice/weakest-practice";

export const metadata: Metadata = { title: "Practice weakest · TeachBack" };

export default async function PracticeWeakestPage({
  params,
}: PageProps<"/courses/[courseId]/practice/weakest">) {
  const { courseId } = await params;
  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Practice weakest</h1>
      <WeakestPractice courseId={courseId} />
    </section>
  );
}
