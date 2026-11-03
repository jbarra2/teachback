import Link from "next/link";
import { cn, focusRing } from "@/components/ui";

const link = cn(
  "rounded-md px-3 py-2 text-sm font-medium hover:bg-surface",
  focusRing,
);

// Signed-in state arrives with auth (T06); until then both sets of links show.
export function TopNav() {
  return (
    <header className="border-b border-border">
      <nav
        aria-label="Main"
        className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3"
      >
        <Link
          href="/"
          className={cn("text-lg font-semibold", focusRing, "rounded-md px-1")}
        >
          TeachBack
        </Link>
        <ul className="flex items-center gap-1">
          <li>
            <Link href="/courses" className={link}>
              Courses
            </Link>
          </li>
          <li>
            <Link href="/login" className={link}>
              Log in
            </Link>
          </li>
          <li>
            <Link
              href="/signup"
              className={cn(
                link,
                "bg-primary text-primary-foreground hover:bg-primary hover:opacity-90",
              )}
            >
              Sign up
            </Link>
          </li>
        </ul>
      </nav>
    </header>
  );
}
