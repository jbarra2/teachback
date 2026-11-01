// AI_PROVIDER=fake: free, deterministic answers for dev, tests and CI (PLAN §8), plus failure modes.
// Fixtures are built from the <chunk id="..."> tags in the prompt, so chunk ids and quotes are real
// and later steps (dropping unknown ids, verifyEvidence) behave as they would with Claude.
//
// Pick a failure mode with setFakeFailure() in tests, or AI_FAKE_FAILURE for a running app.
import {
  APIConnectionTimeoutError,
  InternalServerError,
  RateLimitError,
} from "@anthropic-ai/sdk";
import type { AiRequest, AiTask, Transport } from "./provider";

export const FAKE_FAILURE_MODES = [
  "timeout",
  "malformed",
  "rate_limited",
  "server_error",
  "fabricated_evidence",
] as const;
export type FakeFailureMode = (typeof FAKE_FAILURE_MODES)[number];

let failureOverride: FakeFailureMode | null = null;

/** Forces a failure mode for every fake call until cleared with null. Takes precedence over AI_FAKE_FAILURE. */
export function setFakeFailure(mode: FakeFailureMode | null): void {
  failureOverride = mode;
}

function failureFromEnv(): FakeFailureMode | null {
  const value = process.env.AI_FAKE_FAILURE?.trim();
  if (!value) return null;
  if (!(FAKE_FAILURE_MODES as readonly string[]).includes(value)) {
    throw new Error(
      `AI_FAKE_FAILURE must be empty or one of: ${FAKE_FAILURE_MODES.join(", ")}.`,
    );
  }
  return value as FakeFailureMode;
}

/** Reads the failure mode once, so a bad AI_FAKE_FAILURE fails the call instead of being retried. */
export function createFakeTransport(): Transport {
  const failure = failureOverride ?? failureFromEnv();
  return async (request) => {
    switch (failure) {
      case "timeout":
        throw new APIConnectionTimeoutError();
      case "rate_limited":
        throw new RateLimitError(
          429,
          undefined,
          "Fake rate limit",
          new Headers(),
        );
      case "server_error":
        throw new InternalServerError(
          500,
          undefined,
          "Fake server error",
          new Headers(),
        );
      case "malformed":
        return "{ this is not the JSON you asked for";
      default:
        return FIXTURES[request.task](
          readChunks(request),
          failure === "fabricated_evidence",
        );
    }
  };
}

interface Chunk {
  id: string;
  text: string;
}

const CHUNK_TAG = /<chunk\s+id="([^"]+)"[^>]*>([\s\S]*?)<\/chunk>/g;
const NO_CHUNKS: Chunk[] = [
  { id: "chunk-1", text: "Fake notes for the fake provider." },
];

function readChunks({ user }: AiRequest): Chunk[] {
  const chunks = [...user.matchAll(CHUNK_TAG)].map(([, id, text]) => ({
    id,
    text: text.trim(),
  }));
  return chunks.length > 0 ? chunks : NO_CHUNKS;
}

/** The first `count` words of `text`, verbatim, so the result is a substring of it. */
function firstWords(text: string, count: number): string {
  const match = new RegExp(`^\\S+(?:\\s+\\S+){0,${count - 1}}`).exec(text);
  return match ? match[0] : text;
}

const CONCEPT_COUNT = 8;

const FIXTURES: Record<
  AiTask,
  (chunks: Chunk[], fabricateEvidence: boolean) => unknown
> = {
  extractConcepts: (chunks) => {
    const concepts = Array.from({ length: CONCEPT_COUNT }, (_, i) => {
      const chunk = chunks[i % chunks.length];
      return {
        name: `Fake concept ${i + 1}`,
        summary: `Summary of: ${firstWords(chunk.text, 12)}`,
        chunkIds: [chunk.id],
      };
    });
    const edges = concepts
      .slice(1)
      .map((concept, i) => ({ from: concepts[i].name, to: concept.name }));
    return { concepts, edges };
  },

  generateQuestion: (chunks) => ({
    text: `In your own words, explain the idea behind "${firstWords(chunks[0].text, 6)}". Why does it matter?`,
    kind: "EXPLAIN",
    sourceChunkIds: chunks.slice(0, 2).map((chunk) => chunk.id),
  }),

  evaluateAnswer: (chunks, fabricateEvidence) => ({
    verdict: "PARTIAL",
    whatCorrect: "You described the main idea in your own words.",
    whatMissing: "Explain why it matters, using the example from your notes.",
    evidence: fabricateEvidence
      ? [
          {
            chunkId: chunks[0].id,
            quote:
              "This sentence was invented and appears nowhere in the notes.",
          },
          { chunkId: "chunk-that-does-not-exist", quote: "Made-up evidence." },
        ]
      : chunks.slice(0, 2).map((chunk) => ({
          chunkId: chunk.id,
          quote: firstWords(chunk.text, 12),
        })),
    confidence: "MEDIUM",
    outsideNotes: false,
  }),
};
