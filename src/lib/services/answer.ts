// Answers (T22, PLAN §8 task 3 and the answer flow in §4): grade an answer to one of the user's
// questions against that concept's notes, keep only quotes that really appear in them, then save
// the Attempt and apply the mastery update (T24, PLAN §9) in one transaction. The question is
// loaded only through a course the user owns; another user's question reads as not found. The AI
// call runs under one overall deadline and outside any transaction.
import { Prisma } from "@/generated/prisma/client";
import type { components } from "@/lib/api-client/schema";
import { withDeadline } from "@/lib/ai/deadline";
import { type AnswerSource, evaluateAnswer } from "@/lib/ai/evaluate-answer";
import { verifyEvidence } from "@/lib/ai/verify-evidence";
import { db } from "@/lib/db";
import {
  LEARNING_RATE,
  masteryState,
  RESULT_VALUE,
  UNSEEN,
} from "@/lib/mastery";
import { inNoteOrder, NOTE_CHUNK_SELECT } from "./questions";

type Schemas = components["schemas"];
export type Feedback = Schemas["Feedback"];
export type AnswerResult = Schemas["AnswerResult"];

/** The whole AI step: one attempt (60 s) plus a quick retry, not two full timeouts. */
export const ANSWER_DEADLINE_MS = 90_000;

export interface GradedAttempt {
  userId: string;
  questionId: string;
  conceptId: string;
  answer: string;
  feedback: Feedback;
}

/**
 * Grades and saves the user's answer. Null when the question isn't theirs (or its concept has no
 * notes left to grade against). Throws AiError when the AI can't give a usable grading.
 */
export async function answerQuestion(
  userId: string,
  questionId: string,
  answer: string,
): Promise<AnswerResult | null> {
  const question = await db.question.findFirst({
    where: { id: questionId, concept: { course: { userId } } },
    select: {
      id: true,
      text: true,
      conceptId: true,
      concept: {
        select: {
          chunks: { select: { chunk: { select: NOTE_CHUNK_SELECT } } },
        },
      },
    },
  });
  if (!question || question.concept.chunks.length === 0) return null;

  const chunks = inNoteOrder(question.concept.chunks.map(({ chunk }) => chunk));
  // Short ids made here: the model never sees, or picks, a database id.
  const sources: AnswerSource[] = chunks.map((chunk, index) => ({
    key: `s${index + 1}`,
    refLabel: chunk.refLabel,
    text: chunk.text,
  }));
  const chunkByKey = new Map(
    sources.map((source, index) => [source.key, chunks[index]]),
  );

  const { feedback, sent } = await withDeadline(
    evaluateAnswer(question.text, sources, answer),
    ANSWER_DEADLINE_MS,
  );
  // Checked against the text the model was shown, so a quote from a chunk cut for the budget fails.
  const verified = verifyEvidence(
    feedback,
    sent.map((source) => ({ id: source.key, text: source.text })),
  );
  const graded: Feedback = {
    ...verified,
    evidence: verified.evidence.map(({ chunkId, quote }) => {
      // verifyEvidence keeps only keys of sent sources, and every sent key is in chunkByKey.
      const chunk = chunkByKey.get(chunkId) as (typeof chunks)[number];
      return { chunkId: chunk.id, refLabel: chunk.refLabel, quote };
    }),
  };

  try {
    return await db.$transaction((tx) =>
      recordAttempt(tx, {
        userId,
        questionId: question.id,
        conceptId: question.conceptId,
        answer,
        feedback: graded,
      }),
    );
  } catch (error) {
    // The question (or its course) was deleted during the grading call: the Attempt's foreign key
    // fails, the transaction rolls back, and the question now reads as not found.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2003"
    )
      return null;
    throw error;
  }
}

/**
 * Saves the Attempt and applies the mastery update, inside the caller's transaction, so both are
 * kept or neither is. A LOW-confidence grade changes nothing, not even the attempt count (PLAN §9,
 * the same as `applyResult`), so mastery is read and returned as it stands. Not exported: it trusts
 * `userId` and `conceptId`, which only answerQuestion's ownership-scoped query may supply.
 */
async function recordAttempt(
  tx: Prisma.TransactionClient,
  { userId, questionId, conceptId, answer, feedback }: GradedAttempt,
): Promise<AnswerResult> {
  const attempt = await tx.attempt.create({
    data: {
      userId,
      questionId,
      answer,
      verdict: feedback.verdict,
      confidence: feedback.confidence,
      feedback,
    },
    select: { id: true },
  });
  const { score, attempts } =
    feedback.confidence === "LOW"
      ? ((await tx.mastery.findUnique({
          where: { userId_conceptId: { userId, conceptId } },
          select: { score: true, attempts: true },
        })) ?? UNSEEN)
      : await applyMastery(tx, userId, conceptId, feedback.verdict);
  return {
    attemptId: attempt.id,
    feedback,
    mastery: { state: masteryState({ score, attempts }), score },
  };
}

/**
 * PLAN §9's update as one atomic statement: `score + 0.5 × (result − score)`, one more attempt,
 * seen now. The first answer inserts the row (from 0, so the score is 0.5 × result); a later one
 * takes the row's lock through ON CONFLICT, so parallel answers queue instead of losing updates.
 */
async function applyMastery(
  tx: Prisma.TransactionClient,
  userId: string,
  conceptId: string,
  verdict: Feedback["verdict"],
): Promise<{ score: number; attempts: number }> {
  const result = RESULT_VALUE[verdict];
  const now = new Date();
  const [row] = await tx.$queryRaw<{ score: number; attempts: number }[]>`
    INSERT INTO "Mastery" ("userId", "conceptId", "score", "attempts", "lastSeenAt")
    VALUES (${userId}, ${conceptId}, ${LEARNING_RATE * result}::float8, 1, ${now})
    ON CONFLICT ("userId", "conceptId") DO UPDATE SET
      "score" = "Mastery"."score" + ${LEARNING_RATE}::float8 * (${result}::float8 - "Mastery"."score"),
      "attempts" = "Mastery"."attempts" + 1,
      "lastSeenAt" = EXCLUDED."lastSeenAt"
    RETURNING "score", "attempts"`;
  return row;
}
