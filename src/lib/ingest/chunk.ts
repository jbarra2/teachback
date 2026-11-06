// Splits note text into the passages that concepts, questions and evidence cite (PLAN §8; Chunk in
// §6). Each chunk is an exact slice of the text, so a quote copied from a chunk is also in the
// notes, and nothing is left out but the whitespace between chunks. Pure and deterministic.
// Hyphenated or mid-word line breaks from PDFs are kept as extracted (a text-cleanup follow-up).

import { IngestError } from "./errors";

/** A chunk grows toward this many words, merging small sections, before a heading starts a new one. */
export const MIN_CHUNK_WORDS = 150;
export const MAX_CHUNK_WORDS = 400;
/** For text with few spaces (e.g. Chinese or Japanese), where the word count says little. */
export const MAX_CHUNK_CHARS = 4000;
export const MAX_CHUNKS_PER_DOCUMENT = 300;
/** The title and each heading in a refLabel are cut to these, so a label stays short. */
export const MAX_LABEL_TITLE_CHARS = 80;
export const MAX_LABEL_HEADING_CHARS = 60;

const PLAIN_HEADING_MAX_WORDS = 8;
const PLAIN_HEADING_MAX_CHARS = 60;

export interface NoteChunk {
  order: number;
  text: string;
  refLabel: string;
}

/** A range of the text, [start, end), that starts and ends with non-whitespace. */
interface Span {
  start: number;
  end: number;
}

interface Piece extends Span {
  words: number;
}

interface Line extends Span {
  /** The line without surrounding whitespace ("" for a blank line); `start`/`end` bound it. */
  content: string;
}

interface Block extends Span {
  /** False for a heading line with no text after it. */
  body: boolean;
}

interface Section {
  /** null for text before the first heading. */
  heading: string | null;
  blocks: Block[];
}

const graphemes = new Intl.Segmenter("en", { granularity: "grapheme" });

function splitLines(text: string): Line[] {
  const lines: Line[] = [];
  let from = 0;
  for (;;) {
    const newline = text.indexOf("\n", from);
    const to = newline === -1 ? text.length : newline;
    const raw = text.slice(from, to);
    const content = raw.trim();
    const start = from + (raw.length - raw.trimStart().length);
    lines.push({ start, end: start + content.length, content });
    if (newline === -1) return lines;
    from = newline + 1;
  }
}

function wordSpans(text: string, span: Span): Span[] {
  return Array.from(
    text.slice(span.start, span.end).matchAll(/\S+/g),
    (match) => ({
      start: span.start + match.index,
      end: span.start + match.index + match[0].length,
    }),
  );
}

/** Words in a non-empty, trimmed line. */
const countWords = (line: string) => line.split(/\s+/).length;

const FENCE = /^(`{3,}|~{3,})/;
const ATX_HEADING = /^#{1,6}(?:\s|$)/;

/** "## Title ##" → "Title". By hand, since a regex for the closing #s backtracks on long lines. */
function atxHeadingText(content: string): string {
  const text = content.replace(/^#+/, "").trim();
  let end = text.length;
  while (end > 0 && text[end - 1] === "#") end--;
  return end === 0 || /\s/.test(text[end - 1])
    ? text.slice(0, end).trim()
    : text;
}

/** Markdown headings outside code blocks, by line index. */
function markdownHeadings(lines: Line[]): Map<number, string> {
  const headings = new Map<number, string>();
  let fence: string | null = null;
  lines.forEach(({ content }, index) => {
    const marker = FENCE.exec(content)?.[1];
    if (marker !== undefined) {
      if (fence === null) fence = marker[0];
      else if (marker[0] === fence) fence = null;
      return;
    }
    if (fence !== null || !ATX_HEADING.test(content)) return;
    const heading = atxHeadingText(content);
    if (heading !== "") headings.set(index, heading);
  });
  return headings;
}

const LIST_ITEM = /^(?:[-*+•]|\d+[.)])\s/u;
const CLOSERS = "\"'”’)]";

/** Ends in . ! ? (or : when `colon`), ignoring closing quotes and brackets. */
function endsSentence(text: string, colon = false): boolean {
  let end = text.length;
  while (end > 0 && CLOSERS.includes(text[end - 1])) end--;
  const last = text[end - 1];
  return (
    last === "." || last === "!" || last === "?" || (colon && last === ":")
  );
}

/**
 * Plain-text and PDF headings: a short line that starts with a letter or digit, isn't a list item
 * or a sentence, comes first or after a blank line or a finished sentence, and has text after it.
 * A line that a PDF wrapped mid-sentence fails the "after" rule.
 */
function plainHeadings(lines: Line[]): Map<number, string> {
  const headings = new Map<number, string>();
  let lastText = lines.length - 1;
  while (lastText >= 0 && lines[lastText].content === "") lastText--;
  lines.forEach(({ content }, index) => {
    if (content === "" || index >= lastText) return;
    if (content.length > PLAIN_HEADING_MAX_CHARS) return;
    if (countWords(content) > PLAIN_HEADING_MAX_WORDS) return;
    if (!/^[\p{L}\p{N}]/u.test(content) || !/\p{L}/u.test(content)) return;
    if (/[.,;:!?-]$/.test(content) || LIST_ITEM.test(content)) return;
    const previous = index === 0 ? "" : lines[index - 1].content;
    if (previous !== "" && !endsSentence(previous, true)) return;
    headings.set(index, content);
  });
  return headings;
}

/**
 * Sections in order, each with its blocks: paragraphs separated by blank lines, with a heading line
 * joined to the paragraph after it so a chunk never ends on a bare heading.
 */
function sections(text: string): Section[] {
  const lines = splitLines(text);
  const markdown = markdownHeadings(lines);
  const headings = markdown.size > 0 ? markdown : plainHeadings(lines);

  const result: Section[] = [{ heading: null, blocks: [] }];
  let block: Block | null = null;
  let headingOnly = false;
  const close = () => {
    if (block !== null) result[result.length - 1].blocks.push(block);
    block = null;
  };
  lines.forEach((line, index) => {
    const heading = headings.get(index);
    if (heading !== undefined) {
      close();
      result.push({ heading, blocks: [] });
      block = { start: line.start, end: line.end, body: false };
      headingOnly = true;
      return;
    }
    if (line.content === "") {
      if (!headingOnly) close();
      return;
    }
    if (block === null)
      block = { start: line.start, end: line.end, body: true };
    else block = { ...block, end: line.end, body: true };
    headingOnly = false;
  });
  close();
  return result.filter((section) => section.blocks.length > 0);
}

/** Splits a word with no spaces at grapheme boundaries, so no emoji or accent is ever broken. */
function splitLongWord(text: string, word: Span): Piece[] {
  const pieces: Piece[] = [];
  let start = word.start;
  let end = word.start;
  for (const { segment } of graphemes.segment(
    text.slice(word.start, word.end),
  )) {
    if (end > start && end + segment.length - start > MAX_CHUNK_CHARS) {
      pieces.push({ start, end, words: 1 });
      start = end;
    }
    end += segment.length;
  }
  pieces.push({ start, end, words: 1 });
  return pieces;
}

const fits = (piece: Piece) =>
  piece.words <= MAX_CHUNK_WORDS && piece.end - piece.start <= MAX_CHUNK_CHARS;

/** Greedily joins consecutive pieces while the result still fits. */
function pack(pieces: Piece[]): Piece[] {
  const packed: Piece[] = [];
  for (const piece of pieces) {
    const last = packed.at(-1);
    const joined = last && {
      start: last.start,
      end: piece.end,
      words: last.words + piece.words,
    };
    if (joined && fits(joined)) packed[packed.length - 1] = joined;
    else packed.push({ ...piece });
  }
  return packed;
}

/** A block as pieces that each fit in a chunk: whole if it can, else by sentences, words, graphemes. */
function fitBlock(text: string, block: Span): Piece[] {
  const words = wordSpans(text, block);
  const whole = { ...block, words: words.length };
  if (fits(whole)) return [whole];

  const sentences: Piece[] = [];
  let first = 0;
  words.forEach((word, i) => {
    if (i < words.length - 1 && !endsSentence(text.slice(word.start, word.end)))
      return;
    sentences.push({
      start: words[first].start,
      end: word.end,
      words: i - first + 1,
    });
    first = i + 1;
  });

  const pieces = sentences.flatMap((sentence) =>
    fits(sentence)
      ? [sentence]
      : wordSpans(text, sentence).flatMap((word) =>
          word.end - word.start <= MAX_CHUNK_CHARS
            ? [{ ...word, words: 1 }]
            : splitLongWord(text, word),
        ),
  );
  return pack(pieces);
}

/** Collapses whitespace and cuts to `max` characters at a grapheme boundary. */
function labelPart(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  let cut = "";
  for (const { segment } of graphemes.segment(clean)) {
    if (cut.length + segment.length > max - 1) break;
    cut += segment;
  }
  return `${cut.trimEnd()}…`;
}

interface Draft extends Piece {
  /** Indexes of the first and last section the chunk has text from. */
  first: number;
  last: number;
  /** False if the chunk is only headings. */
  body: boolean;
}

/**
 * Splits notes into chunks of about MIN_CHUNK_WORDS–MAX_CHUNK_WORDS words, preferring to break at
 * headings, then paragraphs, then sentences. The refLabel names where a chunk starts,
 * `<title> › <heading> ¶n` (n counts the chunks with text from that heading), and, when small
 * sections were merged into it, the last heading it reaches: `<title> › <heading> ¶n – <last>`.
 * Throws IngestError TOO_MANY_CHUNKS above MAX_CHUNKS_PER_DOCUMENT rather than dropping text.
 */
export function chunk(text: string, title: string): NoteChunk[] {
  const parts = sections(text);
  const drafts: Draft[] = [];
  let current: Draft | null = null;
  const finish = () => {
    if (current === null) return;
    drafts.push(current);
    current = null;
    if (drafts.length > MAX_CHUNKS_PER_DOCUMENT)
      throw new IngestError("TOO_MANY_CHUNKS");
  };

  parts.forEach((section, index) => {
    section.blocks.forEach((block, blockIndex) => {
      fitBlock(text, block).forEach((piece, pieceIndex) => {
        const startsSection =
          section.heading !== null && blockIndex === 0 && pieceIndex === 0;
        if (current !== null) {
          const joined = {
            start: current.start,
            end: piece.end,
            words: current.words + piece.words,
          };
          if (
            (startsSection && current.words >= MIN_CHUNK_WORDS) ||
            !fits(joined)
          )
            finish();
          else
            current = {
              ...current,
              ...joined,
              last: index,
              body: current.body || block.body,
            };
        }
        current ??= { ...piece, first: index, last: index, body: block.body };
      });
    });
  });
  // Headings at the very end have no text of their own to cite, so they join the chunk before
  // them when it still fits (its label then reaches the last heading); otherwise they stay apart.
  const attachTrailingHeadings = () => {
    const previous = drafts.at(-1);
    if (current === null || current.body || previous === undefined) return;
    const joined = {
      start: previous.start,
      end: current.end,
      words: previous.words + current.words,
    };
    if (!fits(joined)) return;
    drafts[drafts.length - 1] = { ...previous, ...joined, last: current.last };
    current = null;
  };
  attachTrailingHeadings();
  finish();

  const name = labelPart(title, MAX_LABEL_TITLE_CHARS);
  // Once per section, not per chunk: one long heading can start hundreds of chunks.
  const headings = parts.map(({ heading }) =>
    heading === null ? null : labelPart(heading, MAX_LABEL_HEADING_CHARS),
  );
  const seen = parts.map(() => 0);
  return drafts.map((draft, order) => {
    for (let s = draft.first; s <= draft.last; s++) seen[s]++;
    const first = headings[draft.first];
    // Only text before the first heading has none, so a later section always has one.
    const last = draft.last === draft.first ? null : headings[draft.last];
    const start = first === null ? name : `${name} › ${first}`;
    const end = last === null ? "" : ` – ${last}`;
    return {
      order,
      text: text.slice(draft.start, draft.end),
      refLabel: `${start} ¶${seen[draft.first]}${end}`,
    };
  });
}
