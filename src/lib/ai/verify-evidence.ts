// The grounding guarantee (docs/PLAN.md §8): a quote the model cites survives only if it really
// appears in the note section it names. Plain code, no AI, so nothing in the notes or the answer
// can talk its way past it. T22 runs it on every grading before anything is stored or shown.

export type Confidence = "HIGH" | "MEDIUM" | "LOW";

export interface EvidenceItem {
  chunkId: string;
  quote: string;
}

export interface VerifiableFeedback {
  evidence: EvidenceItem[];
  confidence: Confidence;
}

export interface SourceChunk {
  id: string;
  text: string;
}

// `evidence` and `confidence` are named again so they keep their types even when F has an index
// signature (e.g. a zod looseObject), which `Omit` would otherwise flatten to `unknown`.
export type VerifiedFeedback<F extends VerifiableFeedback> = Omit<
  F,
  "evidence" | "confidence" | "unsupported"
> & {
  evidence: F["evidence"];
  confidence: Confidence;
  unsupported: boolean;
};

const SINGLE_QUOTES = /[‘’‚‛′‹›]/g;
const DOUBLE_QUOTES = /[“”„‟«»]/g;
const DASHES = /[‐-―−]/g;

/**
 * What "appears in the notes" is measured on: compatibility-folded (NFKC, so the "ﬁ" ligature and
 * "…" in PDF text match the model's "fi" and "..."), lowercased, quotes and dashes straightened,
 * whitespace collapsed. Folding is applied to both sides, so it can't make different words match.
 */
export function normalizeForMatch(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(SINGLE_QUOTES, "'")
    .replace(DOUBLE_QUOTES, '"')
    .replace(DASHES, "-")
    .replace(/\s+/g, " ")
    .trim();
}

// A word or two appears in almost any note, so it proves nothing (and an empty quote is a
// substring of everything). Counted after normalizeForMatch, which leaves single spaces.
const MIN_QUOTE_WORDS = 3;

const AT_MOST_MEDIUM: Record<Confidence, Confidence> = {
  HIGH: "MEDIUM",
  MEDIUM: "MEDIUM",
  LOW: "LOW",
};

/**
 * Keeps evidence only if its chunk was provided and its normalized quote is at least three words
 * and a substring of that chunk. Any drop caps confidence at MEDIUM; no evidence left means LOW and `unsupported`.
 * `unsupported` is always set here, never taken from the input. The input is not mutated.
 */
export function verifyEvidence<F extends VerifiableFeedback>(
  feedback: F,
  chunks: readonly SourceChunk[],
): VerifiedFeedback<F> {
  const texts = new Map(chunks.map((chunk) => [chunk.id, chunk.text]));
  const normalized = new Map<string, string>();

  const evidence = feedback.evidence.filter(({ chunkId, quote }) => {
    const text = texts.get(chunkId);
    if (text === undefined) return false;
    const needle = normalizeForMatch(quote);
    if (needle.split(" ").length < MIN_QUOTE_WORDS) return false;
    let haystack = normalized.get(chunkId);
    if (haystack === undefined) {
      haystack = normalizeForMatch(text);
      normalized.set(chunkId, haystack);
    }
    return haystack.includes(needle);
  });

  const unsupported = evidence.length === 0;
  const confidence: Confidence = unsupported
    ? "LOW"
    : evidence.length < feedback.evidence.length
      ? AT_MOST_MEDIUM[feedback.confidence]
      : feedback.confidence;
  return { ...feedback, evidence, confidence, unsupported };
}
