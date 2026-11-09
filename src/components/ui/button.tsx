import type { ButtonHTMLAttributes } from "react";
import { cn, focusRing } from "./cn";
import { Spinner } from "./spinner";

const VARIANTS = {
  primary: "bg-primary text-primary-foreground hover:opacity-90",
  secondary:
    "border border-border bg-background text-foreground hover:bg-surface",
  ghost: "text-foreground hover:bg-surface",
  danger: "bg-danger text-primary-foreground hover:opacity-90",
} as const;

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof VARIANTS;
  /** Disables the button and shows a spinner, so a pending action can't be sent twice. */
  loading?: boolean;
}

export function Button({
  variant = "primary",
  loading = false,
  disabled,
  type = "button",
  className,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        // min-h-11: at least 44 px tall, easy to tap on a phone (T32).
        "inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition",
        "disabled:cursor-not-allowed disabled:opacity-60",
        focusRing,
        VARIANTS[variant],
        className,
      )}
      {...props}
    >
      {loading && <Spinner label="Working…" />}
      {children}
    </button>
  );
}
