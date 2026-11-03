"use client";
// One concept on the map: its name and state in words (not color alone), linking to practice.
import { Handle, Position, type NodeProps } from "@xyflow/react";
import Link from "next/link";
import { cn, focusRing, MasteryBadge } from "@/components/ui";
import type { MasteryState } from "@/lib/api-client";
import type { ConceptNode as ConceptNodeType } from "./layout";

/** Border color per state, matching MASTERY_BADGE's tones. Spelled out so Tailwind finds them. */
export const STATE_BORDER: Record<MasteryState, string> = {
  MASTERED: "border-success",
  REVIEW: "border-warning",
  PRACTICE: "border-danger",
};

// Edges attach to these; they're invisible because the map is read-only.
const hiddenHandle = "!size-1 !min-h-0 !min-w-0 !border-0 !bg-transparent";

export function ConceptNode({ data }: NodeProps<ConceptNodeType>) {
  return (
    <>
      <Handle
        type="target"
        position={Position.Top}
        isConnectable={false}
        className={hiddenHandle}
      />
      <Link
        href={data.href}
        // The name may be cut to one line; this shows all of it on hover.
        title={data.name}
        className={cn(
          // Fills the node, whose size layoutMap sets.
          "flex size-full flex-col items-start justify-center gap-1 rounded-lg border-2 bg-background px-3 text-left shadow-sm hover:bg-surface",
          STATE_BORDER[data.state],
          focusRing,
        )}
      >
        <span className="line-clamp-1 text-sm font-medium text-foreground">
          {data.name}
        </span>
        <MasteryBadge state={data.state} />
      </Link>
      <Handle
        type="source"
        position={Position.Bottom}
        isConnectable={false}
        className={hiddenHandle}
      />
    </>
  );
}
