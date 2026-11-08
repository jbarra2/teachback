// Answers (T22, PLAN §8 task 3 and the answer flow in §4): grade an answer to one of the user's
// questions against that concept's notes, keep only quotes that really appear in them, and save the
// Attempt. The question is loaded only through a course the user owns; another user's question
// reads as not found. The AI call runs under one overall deadline and outside any transaction.
import type { Prisma } from "@/generated/prisma/client";
import type { components } from "@/lib/api-client/schema";
import { withDeadline } from "@/lib/ai/deadline";
import { type AnswerSource, evaluateAnswer } from "@/lib/ai/evaluate-answer";
import { verifyEvidence } from "@/lib/ai/verify-evidence";
import { db } from "@/lib/db";
import { masteryState, UNSEEN } from "@/lib/mastery";
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

  return db.$transaction((tx) =>
    recordAttempt(tx, {
      userId,
      questionId: question.id,
      conceptId: question.conceptId,
      answer,
      feedback: graded,
    }),
  );
}

/**
 * Saves the Attempt and reads the concept's mastery, inside the caller's transaction. Mastery is
 * returned as it stands for now; T24 applies the row-locked update here, in the same transaction.
 */
export async function recordAttempt(
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
  const mastery = await tx.mastery.findUnique({
    where: { userId_conceptId: { userId, conceptId } },
    select: { score: true, attempts: true },
  });
  const { score, attempts } = mastery ?? UNSEEN;
  return {
    attemptId: attempt.id,
    feedback,
    mastery: { state: masteryState({ score, attempts }), score },
  };
}
