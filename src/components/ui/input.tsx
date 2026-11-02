import type { InputHTMLAttributes } from "react";
import { cn, focusRing } from "./cn";
import { Field, describedBy } from "./field";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  id: string;
  label: string;
  hint?: string;
  error?: string;
}

export const controlClass =
  "rounded-md border border-border bg-background px-3 py-2 text-sm aria-[invalid=true]:border-danger";

export function Input({
  id,
  label,
  hint,
  error,
  className,
  ...props
}: InputProps) {
  return (
    <Field id={id} label={label} hint={hint} error={error}>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, { hint, error })}
        className={cn(controlClass, focusRing, className)}
        {...props}
      />
    </Field>
  );
}
