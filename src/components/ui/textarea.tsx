import type { TextareaHTMLAttributes } from "react";
import { cn, focusRing } from "./cn";
import { Field, describedBy } from "./field";
import { controlClass } from "./input";

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  /** Shows "used / max" under the box. Pair it with a controlled `value`. */
  showCount?: boolean;
}

export function Textarea({
  id,
  label,
  hint,
  error,
  showCount = false,
  maxLength,
  value,
  className,
  ...props
}: TextareaProps) {
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
      <textarea
        id={id}
        maxLength={maxLength}
        value={value}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, { hint, error })}
        className={cn(controlClass, "min-h-32", focusRing, className)}
        {...props}
      />
    </Field>
  );
}
