import { cn, MASTERY_BADGE } from "@/components/ui";
import type { MasteryState } from "@/lib/api-client";
import { STATE_BORDER } from "./concept-node";

const ORDER: MasteryState[] = ["MASTERED", "REVIEW", "PRACTICE"];

const MEANING: Record<MasteryState, string> = {
  MASTERED: "you've explained it well more than once",
  REVIEW: "partly there, worth another look",
  PRACTICE: "not practiced yet, or needs work",
};

export function Legend() {
  return (
    <ul aria-label="Legend" className="flex flex-wrap gap-4 text-sm">
      {ORDER.map((state) => (
        <li key={state} className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className={cn(
              "size-4 rounded border-2 bg-background",
              STATE_BORDER[state],
            )}
          />
          <span>
            <span className="font-medium">{MASTERY_BADGE[state].label}</span>
            <span className="text-muted">: {MEANING[state]}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
