import type { InputHTMLAttributes, Ref } from "react";
import { cn, focusRing } from "./cn";
import { Field, describedBy } from "./field";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  /** Shows "used / max" under the field. Pair it with a controlled `value`. */
  showCount?: boolean;
  ref?: Ref<HTMLInputElement>;
}

export const controlClass =
  "rounded-md border border-border bg-background px-3 py-2 text-sm aria-[invalid=true]:border-danger";

export function Input({
  id,
  label,
  hint,
  error,
  showCount = false,
  maxLength,
  value,
  className,
  ...props
}: InputProps) {
  const used = typeof value === "string" ? value.length : 0;
  const counter =
    showCount && maxLength !== undefined ? (
      <p
        id={`${id}-count`}
        aria-live="polite"
        className={cn(
          "text-xs",
          used >= maxLength ? "text-danger" : "text-muted",
        )}
      >
        {used} / {maxLength}
      </p>
    ) : undefined;
  return (
    <Field id={id} label={label} hint={hint} error={error} footer={counter}>
      <input
        id={id}
        maxLength={maxLength}
        value={value}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, { hint, error })}
        className={cn(controlClass, focusRing, className)}
        {...props}
      />
    </Field>
  );
}
