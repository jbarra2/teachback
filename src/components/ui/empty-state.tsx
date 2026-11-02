import type { ReactNode } from "react";
import { cn } from "./cn";

interface EmptyStateProps {
  title: string;
  description?: string;
  /** A button or link to the next step. */
  action?: ReactNode;
  className?: string;
}

export function EmptyState({
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-3 rounded-lg border border-dashed border-border px-6 py-12 text-center",
        className,
      )}
    >
      <h2 className="text-lg font-semibold">{title}</h2>
      {description && (
        <p className="max-w-md text-sm text-muted">{description}</p>
      )}
      {action}
    </div>
  );
}
