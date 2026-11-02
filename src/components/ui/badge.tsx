import type { ReactNode } from "react";
import type { components } from "@/lib/api-client/schema";
import { cn } from "./cn";

type MasteryState = components["schemas"]["MasteryState"];

const TONES = {
  neutral: "border-border text-muted",
  success: "border-success text-success",
  warning: "border-warning text-warning",
  danger: "border-danger text-danger",
} as const;

export type BadgeTone = keyof typeof TONES;

interface BadgeProps {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
}

export function Badge({ tone = "neutral", children, className }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium",
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** How each mastery state reads in the UI (PLAN §9: MASTERED shows as "Seems understood"). */
export const MASTERY_BADGE: Record<
  MasteryState,
  { label: string; tone: BadgeTone }
> = {
  MASTERED: { label: "Seems understood", tone: "success" },
  REVIEW: { label: "Review", tone: "warning" },
  PRACTICE: { label: "Practice", tone: "danger" },
};

export function MasteryBadge({ state }: { state: MasteryState }) {
  const { label, tone } = MASTERY_BADGE[state];
  return <Badge tone={tone}>{label}</Badge>;
}
