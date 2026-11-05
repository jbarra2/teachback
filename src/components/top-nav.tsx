import Link from "next/link";
import { cn, focusRing } from "@/components/ui";
import { NavAuth, navLink } from "./nav-auth";

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
