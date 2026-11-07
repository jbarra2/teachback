// Documents (T12, PLAN §4 upload flow): save an upload, process it into chunks and concepts after
// the response, and report its status. Every query is scoped to the signed-in user through the
// course, so another user's course or document reads as not found.
//
// Processing calls the AI outside any transaction, then writes chunks, concepts, links and edges
// in one short transaction, so a failure never leaves part of a document behind. A failed document
// stores only fixed, user-written messages: never exception text, AI output or file details.
import { withDeadline } from "@/lib/ai/deadline";
import { AiError } from "@/lib/ai/errors";
import { extractConcepts, type ConceptSource } from "@/lib/ai/extract-concepts";
import { runAfterResponse } from "@/lib/api/background";
import { db } from "@/lib/db";
import type { SourceType } from "@/generated/prisma/client";
import { chunk } from "@/lib/ingest/chunk";
import { IngestError } from "@/lib/ingest/errors";
import { extractText, normalizeNoteText } from "@/lib/ingest/extract-text";
import { log } from "@/lib/log";
import {
  FAILED_FALLBACK_MESSAGE,
  visibleStatus,
  type VisibleStatus,
} from "./document-status";

/** What the route has parsed and checked (UploadDocumentForm). */
export interface UploadInput {
  courseId: string;
  title: string;
  file?: File;
  text?: string;
}

export const AI_FAILED_MESSAGE =
  "We couldn't analyse these notes right now. Please upload them again in a few minutes.";
export const NO_CONCEPTS_MESSAGE =
  "We couldn't find any concepts in these notes. Try notes that explain a topic in full sentences.";

const ID_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";

/** A new id shaped like Prisma's cuid(): "c" and 24 lowercase letters or digits (the API's Id). */
function newConceptId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return (
    "c" + Array.from(bytes, (byte) => ID_CHARS[byte % ID_CHARS.length]).join("")
  );
}

/** How long the saving transaction may take; the AI work is already done by then. */
const SAVE_TIMEOUT_MS = 15_000;

/**
 * The whole AI step's deadline: under the 10 minutes after which a pending document reads as
 * FAILED (document-status.ts), so a slow run can't later turn a reported failure into READY.
 */
export const EXTRACTION_DEADLINE_MS = 8 * 60 * 1000;

function sourceTypeOf(filename: string): SourceType {
  const extension = filename.toLowerCase().split(".").pop();
  if (extension === "pdf") return "PDF";
  if (extension === "md") return "MARKDOWN";
  return "TEXT";
}

/**
 * Saves an upload to one of the user's courses and queues its processing. Null when the course
 * isn't theirs (or doesn't exist), checked before the file is read. Throws IngestError for a file
 * or text that can't be used (400/413/422/429).
 */
export async function uploadDocument(
  userId: string,
  input: UploadInput,
): Promise<{ id: string } | null> {
  const course = await db.course.findFirst({
    where: { id: input.courseId, userId },
    select: { id: true },
  });
  if (!course) return null;

  let rawText: string;
  let sourceType: SourceType;
  if (input.file) {
    rawText = await extractText(
      new Uint8Array(await input.file.arrayBuffer()),
      input.file.name,
    );
    sourceType = sourceTypeOf(input.file.name);
  } else {
    rawText = normalizeNoteText(input.text ?? "");
    sourceType = "TEXT";
  }

  const document = await db.document.create({
    data: { courseId: course.id, title: input.title, sourceType, rawText },
    select: { id: true },
  });
  await runAfterResponse(() => processDocument(document.id));
  return document;
}

class NoConceptsError extends Error {
  override name = "NoConceptsError";
}

/** The message a FAILED document shows: fixed text only. */
function failureMessage(error: unknown): string {
  // IngestError messages are fixed per reason and name no note text (src/lib/ingest/errors.ts).
  if (error instanceof IngestError) return error.message;
  if (error instanceof AiError) return AI_FAILED_MESSAGE;
  if (error instanceof NoConceptsError) return NO_CONCEPTS_MESSAGE;
  return FAILED_FALLBACK_MESSAGE;
}

/**
 * QUEUED → PROCESSING → READY (or FAILED). Claims the document first, so it runs at most once
 * however often it's called.
 */
export async function processDocument(documentId: string): Promise<void> {
  const claimed = await db.document.updateMany({
    where: { id: documentId, status: "QUEUED" },
    data: { status: "PROCESSING" },
  });
  if (claimed.count === 0) return;

  try {
    const document = await db.document.findUniqueOrThrow({
      where: { id: documentId },
      select: { courseId: true, title: true, rawText: true },
    });
    const pieces = chunk(document.rawText, document.title);
    // Short ids made here: the model never sees, or picks, a database id.
    const sources: ConceptSource[] = pieces.map((piece, index) => ({
      key: `c${index + 1}`,
      refLabel: piece.refLabel,
      text: piece.text,
    }));
    const { concepts, edges } = await withDeadline(
      extractConcepts(document.title, sources),
      EXTRACTION_DEADLINE_MS,
    );
    if (concepts.length === 0) throw new NoConceptsError();

    await db.$transaction(
      async (tx) => {
        const chunks = await tx.chunk.createManyAndReturn({
          data: pieces.map((piece) => ({
            documentId,
            order: piece.order,
            text: piece.text,
            refLabel: piece.refLabel,
          })),
          select: { id: true, order: true },
        });
        const chunkIdByOrder = new Map(chunks.map((c) => [c.order, c.id]));
        const chunkIdByKey = new Map(
          sources.map((source, index) => [
            source.key,
            chunkIdByOrder.get(pieces[index].order) as string,
          ]),
        );

        // Sorted, so two uploads to the same course lock concepts in the same order (no deadlock).
        // One atomic INSERT ... ON CONFLICT per concept: a concept another upload already created
        // (or is creating, until it commits) is merged instead of failing on the unique key.
        const conceptIdByKey = new Map<string, string>();
        for (const concept of [...concepts].sort((a, b) =>
          a.nameKey < b.nameKey ? -1 : a.nameKey > b.nameKey ? 1 : 0,
        )) {
          const [saved] = await tx.$queryRaw<{ id: string }[]>`
            INSERT INTO "Concept" ("id", "courseId", "name", "nameKey", "summary")
            VALUES (${newConceptId()}, ${document.courseId}, ${concept.name},
                    ${concept.nameKey}, ${concept.summary})
            ON CONFLICT ("courseId", "nameKey")
            DO UPDATE SET "name" = "Concept"."name"
            RETURNING "id"`;
          conceptIdByKey.set(concept.nameKey, saved.id);
        }

        await tx.conceptChunk.createMany({
          data: concepts.flatMap((concept) =>
            concept.chunkKeys.map((key) => ({
              conceptId: conceptIdByKey.get(concept.nameKey) as string,
              chunkId: chunkIdByKey.get(key) as string,
            })),
          ),
          skipDuplicates: true,
        });
        await tx.conceptEdge.createMany({
          data: edges.map((edge) => ({
            fromId: conceptIdByKey.get(edge.from) as string,
            toId: conceptIdByKey.get(edge.to) as string,
          })),
          skipDuplicates: true,
        });
        await tx.document.update({
          where: { id: documentId },
          data: { status: "READY", error: null },
        });
      },
      { timeout: SAVE_TIMEOUT_MS },
    );
  } catch (error) {
    // The name only: never the title, the notes or what a library said about them.
    log.error("Document processing failed", {
      errorName: error instanceof Error ? error.name : typeof error,
    });
    await db.document.updateMany({
      where: { id: documentId, status: "PROCESSING" },
      data: { status: "FAILED", error: failureMessage(error) },
    });
  }
}

export interface DocumentState extends VisibleStatus {
  id: string;
  conceptCount: number;
}

/** A document's status, if it belongs to one of the user's courses. */
export async function getDocumentStatus(
  userId: string,
  documentId: string,
): Promise<DocumentState | null> {
  const document = await db.document.findFirst({
    where: { id: documentId, course: { userId } },
    select: { id: true, status: true, error: true, createdAt: true },
  });
  if (!document) return null;
  const conceptCount = await db.concept.count({
    where: { chunks: { some: { chunk: { documentId } } } },
  });
  return { id: document.id, ...visibleStatus(document), conceptCount };
}
