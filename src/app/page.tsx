import Link from "next/link";
import { cn, focusRing } from "@/components/ui";

const button = cn("rounded-md px-4 py-2 text-sm font-medium", focusRing);

export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 py-16 text-center">
      <h1 className="text-4xl font-semibold tracking-tight">TeachBack</h1>
      <p className="max-w-md text-lg">
        Explain what you learned in your own words, and get feedback grounded in
        your notes.
      </p>
      <div className="flex gap-3">
        <Link
          href="/courses"
          className={cn(button, "bg-primary text-primary-foreground")}
        >
          Go to my courses
        </Link>
        <Link href="/login" className={cn(button, "border border-border")}>
          Log in
        </Link>
      </div>
    </div>
  );
}
