// Mastery scoring (PLAN §9). Pure functions: the answer service applies the same update in one
// atomic SQL statement, and the UI uses these to label and order concepts.
import type { components } from "@/lib/api-client/schema";

type Schemas = components["schemas"];
export type Verdict = Schemas["Verdict"];
export type Confidence = Schemas["Confidence"];
export type MasteryState = Schemas["MasteryState"];

/** A user's progress on one concept. An unseen concept is { score: 0, attempts: 0, lastSeenAt: null }. */
export interface Mastery {
  score: number;
  attempts: number;
  lastSeenAt: Date | null;
}

/** The grade of one answer, as the Feedback reports it. */
export interface GradedAnswer {
  verdict: Verdict;
  confidence: Confidence;
}

export const RESULT_VALUE: Record<Verdict, number> = {
  CORRECT: 1,
  PARTIAL: 0.5,
  INCORRECT: 0,
};

/** How far each answer moves the score toward its result. */
export const LEARNING_RATE = 0.5;
export const MASTERED_SCORE = 0.75;
export const MASTERED_ATTEMPTS = 2;
export const REVIEW_SCORE = 0.4;

export const UNSEEN: Mastery = { score: 0, attempts: 0, lastSeenAt: null };

/**
 * The mastery after one graded answer: `score + 0.5 × (result − score)`, one more attempt, seen now.
 * A LOW-confidence grade changes nothing, not even the attempt count, so a shaky grade can't count
 * toward the two attempts MASTERED needs.
 */
export function applyResult(
  mastery: Mastery,
  { verdict, confidence }: GradedAnswer,
  now: Date,
): Mastery {
  if (confidence === "LOW") return mastery;
  const result = RESULT_VALUE[verdict];
  return {
    score: mastery.score + LEARNING_RATE * (result - mastery.score),
    attempts: mastery.attempts + 1,
    lastSeenAt: now,
  };
}

/** MASTERED (shown as "Seems understood"), REVIEW, or PRACTICE, which includes unseen concepts. */
export function masteryState({
  score,
  attempts,
}: Pick<Mastery, "score" | "attempts">): MasteryState {
  if (score >= MASTERED_SCORE && attempts >= MASTERED_ATTEMPTS)
    return "MASTERED";
  if (attempts >= 1 && score >= REVIEW_SCORE) return "REVIEW";
  return "PRACTICE";
}
