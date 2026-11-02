// Shared label / hint / error wiring for Input and Textarea.
import type { ReactNode } from "react";

export interface FieldProps {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  /** Extra text under the control, after the hint (e.g. a character counter). */
  footer?: ReactNode;
  children: ReactNode;
}

/** The ids a control should list in aria-describedby. */
export function describedBy(
  id: string,
  { hint, error }: { hint?: string; error?: string },
): string | undefined {
  const ids = [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean);
  return ids.length > 0 ? ids.join(" ") : undefined;
}

export function Field({
  id,
  label,
  hint,
  error,
  footer,
  children,
}: FieldProps) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {hint && (
        <p id={`${id}-hint`} className="text-xs text-muted">
          {hint}
        </p>
      )}
      {footer}
      {error && (
        <p id={`${id}-error`} className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
