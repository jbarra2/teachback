import { cn } from "./cn";

interface SpinnerProps {
  /** Read out by screen readers. */
  label?: string;
  className?: string;
}

export function Spinner({ label = "Loading…", className }: SpinnerProps) {
  return (
    <span role="status" className={cn("inline-flex items-center", className)}>
      <span
        aria-hidden="true"
        className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
      />
      <span className="sr-only">{label}</span>
    </span>
  );
}
