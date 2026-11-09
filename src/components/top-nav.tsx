import Link from "next/link";
import { cn, focusRing } from "@/components/ui";
import { NavAuth, navLink } from "./nav-auth";

export function TopNav() {
  return (
    <header className="border-b border-border">
      <nav
        aria-label="Main"
        className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-4 py-3"
      >
        <Link
          href="/"
          className={cn(
            // min-h-11: at least 44 px tall, easy to tap on a phone (T32).
            "inline-flex min-h-11 items-center text-lg font-semibold",
            focusRing,
            "rounded-md px-1",
          )}
        >
          TeachBack
        </Link>
        <ul className="flex flex-wrap items-center gap-1">
          <li>
            <Link href="/courses" className={navLink}>
              Courses
            </Link>
          </li>
          <NavAuth />
        </ul>
      </nav>
    </header>
  );
}
