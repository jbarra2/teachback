// Questions (T17, PLAN §8 task 2): a new practice question about one of the user's concepts,
// grounded in that concept's notes. The concept is loaded only through a course the user owns;
// another user's concept reads as not found. The AI call runs under one overall deadline.
import { withDeadline } from "@/lib/ai/deadline";
import {
  generateQuestion,
  type QuestionKind,
  type QuestionSource,
} from "@/lib/ai/generate-question";
import { db } from "@/lib/db";

/** How many earlier questions the model is told to avoid repeating (PLAN §8). */
export const RECENT_QUESTION_COUNT = 5;

/** The whole AI step: one attempt (60 s) plus a quick retry, not two full timeouts. */
export const QUESTION_DEADLINE_MS = 90_000;

export interface NewQuestion {
  questionId: string;
  text: string;
  kind: QuestionKind;
  sources: { chunkId: string; refLabel: string }[];
}

/**
 * Asks for and saves a question about the user's concept. Null when the concept isn't theirs (or
 * has no notes to ask from). Throws AiError when the AI can't give a usable question.
 */
export async function createQuestion(
  userId: string,
  conceptId: string,
): Promise<NewQuestion | null> {
  const concept = await db.concept.findFirst({
    where: { id: conceptId, course: { userId } },
    select: {
      id: true,
      name: true,
      summary: true,
      chunks: {
        select: {
          chunk: {
            select: {
              id: true,
              order: true,
              text: true,
              refLabel: true,
              document: { select: { createdAt: true } },
            },
          },
        },
      },
    },
  });
  if (!concept || concept.chunks.length === 0) return null;

  // Oldest document first, then each document's own order: the notes as the student wrote them.
  const chunks = concept.chunks
    .map(({ chunk }) => chunk)
    .sort(
      (a, b) =>
        a.document.createdAt.getTime() - b.document.createdAt.getTime() ||
        a.order - b.order ||
        (a.id < b.id ? -1 : 1),
    );
  // Short ids made here: the model never sees, or picks, a database id.
  const sources: QuestionSource[] = chunks.map((chunk, index) => ({
    key: `s${index + 1}`,
    refLabel: chunk.refLabel,
    text: chunk.text,
  }));
  const chunkByKey = new Map(
    sources.map((source, index) => [source.key, chunks[index]]),
  );

  const recent = await db.question.findMany({
    where: { conceptId: concept.id },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: RECENT_QUESTION_COUNT,
    select: { text: true },
  });

  const generated = await withDeadline(
    generateQuestion(
      { name: concept.name, summary: concept.summary },
      sources,
      recent.map((question) => question.text),
    ),
    QUESTION_DEADLINE_MS,
  );
  const cited = generated.sourceKeys
    .map((key) => chunkByKey.get(key))
    .filter((chunk) => chunk !== undefined);

  const saved = await db.question.create({
    data: {
      conceptId: concept.id,
      text: generated.text,
      kind: generated.kind,
      sourceChunkIds: cited.map((chunk) => chunk.id),
    },
    select: { id: true },
  });
  return {
    questionId: saved.id,
    text: generated.text,
    kind: generated.kind,
    sources: cited.map((chunk) => ({
      chunkId: chunk.id,
      refLabel: chunk.refLabel,
    })),
  };
}
