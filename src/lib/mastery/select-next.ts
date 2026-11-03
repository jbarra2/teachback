// Which concept to practise next (PLAN §9).
import { masteryState, type Mastery, type MasteryState } from "./score";

export interface ConceptProgress extends Mastery {
  id: string;
}

const STATE_ORDER: Record<MasteryState, number> = {
  PRACTICE: 0,
  REVIEW: 1,
  MASTERED: 2,
};

/** Unseen (null) sorts before any date. */
function seenTime(lastSeenAt: Date | null): number {
  return lastSeenAt === null ? -Infinity : lastSeenAt.getTime();
}

function compare(a: ConceptProgress, b: ConceptProgress): number {
  return (
    STATE_ORDER[masteryState(a)] - STATE_ORDER[masteryState(b)] ||
    a.score - b.score ||
    seenTime(a.lastSeenAt) - seenTime(b.lastSeenAt) ||
    // Equal on everything the spec orders by: fall back to the id, so the pick is stable.
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

/**
 * The id of the concept to practise next: PRACTICE before REVIEW before MASTERED, then lowest
 * score, then least recently seen (unseen first). The previous concept is skipped unless it's the
 * only one. Null when there are no concepts.
 */
export function selectNextConcept(
  concepts: readonly ConceptProgress[],
  previousId?: string | null,
): string | null {
  const candidates =
    concepts.length > 1
      ? concepts.filter((concept) => concept.id !== previousId)
      : concepts;
  const [next] = [...candidates].sort(compare);
  return next?.id ?? null;
}
