import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import type { Prisma } from "@/generated/prisma/client";

import {
  chunk,
  MAX_CHUNK_CHARS,
  MAX_CHUNK_WORDS,
  MAX_CHUNKS_PER_DOCUMENT,
  MAX_LABEL_HEADING_CHARS,
  MAX_LABEL_TITLE_CHARS,
  MIN_CHUNK_WORDS,
  type NoteChunk,
} from "./chunk";
import { IngestError } from "./errors";

const FIXTURES = path.resolve(import.meta.dirname, "../../../fixtures/notes");
const graphemes = new Intl.Segmenter("en", { granularity: "grapheme" });
const countWords = (text: string) => text.match(/\S+/g)?.length ?? 0;
const labels = (chunks: NoteChunk[]) => chunks.map((c) => c.refLabel);

/** `n` distinct words tagged with `tag`, as ten-word sentences. */
function prose(n: number, tag: string): string {
  const words = Array.from({ length: n }, (_, i) => `${tag}${i}`);
  for (let i = 9; i < n; i += 10) words[i] += ".";
  words[n - 1] = words[n - 1].replace(/\.?$/, ".");
  return words.join(" ");
}

/** Hard-wraps text every `perLine` words, like PDF text with no blank lines. */
const wrap = (text: string, perLine = 12) =>
  text
    .split(" ")
    .map((word, i) => (i > 0 && i % perLine === 0 ? `\n${word}` : word))
    .join(" ")
    .replace(/ \n/g, "\n");

const section = (heading: string, words: number) =>
  `## ${heading}\n\n${prose(words, heading.replace(/\W/g, ""))}`;

/**
 * The text is exactly: whitespace, chunk 0, whitespace, chunk 1, ... whitespace. So every chunk is a
 * verbatim slice, they're in order, and nothing but whitespace is left out or repeated.
 */
function expectCovers(text: string, chunks: NoteChunk[]): number[] {
  const offsets: number[] = [];
  let cursor = 0;
  chunks.forEach((c, i) => {
    expect(c.order).toBe(i);
    expect(c.text).not.toBe("");
    expect(c.text).toBe(c.text.trim());
    const at = text.indexOf(c.text, cursor);
    expect(at, `chunk ${i} comes after chunk ${i - 1}`).toBeGreaterThanOrEqual(
      cursor,
    );
    expect(text.slice(cursor, at).trim(), `gap before chunk ${i}`).toBe("");
    offsets.push(at, at + c.text.length);
    cursor = at + c.text.length;
  });
  expect(text.slice(cursor).trim(), "text after the last chunk").toBe("");
  return offsets;
}

function expectSizes(chunks: NoteChunk[]) {
  for (const c of chunks) {
    expect(countWords(c.text)).toBeLessThanOrEqual(MAX_CHUNK_WORDS);
    expect(c.text.length).toBeLessThanOrEqual(MAX_CHUNK_CHARS);
  }
}

describe("chunk: Markdown headings", () => {
  it("gives each large-enough section its own chunks, labelled by heading", () => {
    const text = [section("Why TCP", 200), section("Handshake", 160)].join(
      "\n\n",
    );
    const chunks = chunk(text, "Networks");
    expect(labels(chunks)).toEqual([
      "Networks › Why TCP ¶1",
      "Networks › Handshake ¶1",
    ]);
    expect(chunks[1].text.startsWith("## Handshake\n\nHandshake0")).toBe(true);
    expectCovers(text, chunks);
  });

  it("merges small sections forward and names the range of headings it covers", () => {
    const text = ["Alpha", "Beta", "Gamma"]
      .map((h) => section(h, 40))
      .join("\n\n");
    const chunks = chunk(text, "T");
    expect(labels(chunks)).toEqual(["T › Alpha ¶1 – Gamma"]);
    expect(chunks[0].text).toContain("## Beta");
    expectCovers(text, chunks);
  });

  it("stops merging at the first heading once a chunk has MIN_CHUNK_WORDS", () => {
    const text = [
      section("Alpha", MIN_CHUNK_WORDS + 5),
      section("Beta", 30),
      section("Gamma", 30),
    ].join("\n\n");
    expect(labels(chunk(text, "T"))).toEqual([
      "T › Alpha ¶1",
      "T › Beta ¶1 – Gamma",
    ]);
  });

  it("numbers the chunks of a long section, including one that runs into the next", () => {
    const text = [section("Alpha", 900), section("Beta", 20)].join("\n\n");
    const chunks = chunk(text, "T");
    expect(labels(chunks)).toEqual([
      "T › Alpha ¶1",
      "T › Alpha ¶2",
      "T › Alpha ¶3 – Beta",
    ]);
    expectCovers(text, chunks);
    expectSizes(chunks);
  });

  it("restarts the count for each heading", () => {
    const text = [section("Alpha", 500), section("Beta", 500)].join("\n\n");
    expect(labels(chunk(text, "T"))).toEqual([
      "T › Alpha ¶1",
      "T › Alpha ¶2",
      "T › Beta ¶1",
      "T › Beta ¶2",
    ]);
  });

  it("keeps a heading with the text after it, never alone at the end of a chunk", () => {
    const text = [section("Alpha", 390), section("Beta", 390)].join("\n\n");
    const chunks = chunk(text, "T");
    expect(chunks.map((c) => c.text.split("\n")[0])).toEqual([
      "## Alpha",
      "## Beta",
    ]);
    expectCovers(text, chunks);
    // A small chunk is still open when the heading arrives, and the section after it is too big
    // to join: the heading moves to the next chunk with its text.
    const small = [section("Alpha", 100), section("Beta", 390)].join("\n\n");
    const parts = chunk(small, "T");
    expect(labels(parts)).toEqual(["T › Alpha ¶1", "T › Beta ¶1"]);
    expect(parts[0].text.endsWith("Alpha99.")).toBe(true);
    expect(parts[1].text.startsWith("## Beta\n\nBeta0")).toBe(true);
  });

  it("labels text before the first heading with the title alone", () => {
    const text = `${prose(200, "intro")}\n\n${section("Alpha", 200)}`;
    expect(labels(chunk(text, "T"))).toEqual(["T ¶1", "T › Alpha ¶1"]);
    const small = `${prose(20, "intro")}\n\n${section("Alpha", 20)}`;
    expect(labels(chunk(small, "T"))).toEqual(["T ¶1 – Alpha"]);
  });

  it("ignores # lines inside code blocks", () => {
    const code = "```python\n# not a heading\nx = 1\n```";
    const text = `${section("Alpha", 200)}\n\n${code}\n\n${prose(10, "after")}`;
    const chunks = chunk(text, "T");
    expect(labels(chunks)).toEqual(["T › Alpha ¶1"]);
    expectCovers(text, chunks);
    const tilde = `~~~\n# not either\n~~~\n\n${section("Beta", 200)}`;
    expect(labels(chunk(tilde, "T"))).toEqual(["T ¶1 – Beta"]);
    const mixed = `\`\`\`\n~~~\n# still code\n\`\`\`\n\n${section("Gamma", 200)}`;
    expect(labels(chunk(mixed, "T"))).toEqual(["T ¶1 – Gamma"]);
  });

  it("strips closing #s and skips lines that only look like headings", () => {
    const text = [
      `## Alpha ##\n\n${prose(200, "a")}`,
      `#hashtag is text\n\n#\n\n${prose(200, "b")}`,
      `###### Deep C# notes\n\n${prose(200, "c")}`,
    ].join("\n\n");
    expect(labels(chunk(text, "T"))).toEqual([
      "T › Alpha ¶1",
      "T › Alpha ¶2",
      "T › Deep C# notes ¶1",
    ]);
  });

  it("keeps consecutive headings and joins a heading at the very end to the chunk before", () => {
    const text = `## Alpha\n## Beta\n\n${prose(200, "b")}\n\n## Gamma`;
    const chunks = chunk(text, "T");
    expect(labels(chunks)).toEqual(["T › Alpha ¶1 – Gamma"]);
    expect(chunks[0].text.endsWith("b199.\n\n## Gamma")).toBe(true);
    expectCovers(text, chunks);
  });

  it("joins several trailing headings, and keeps a document of only headings", () => {
    const text = `${section("Alpha", 200)}\n\n## Beta\n\n### Gamma`;
    const chunks = chunk(text, "T");
    expect(labels(chunks)).toEqual(["T › Alpha ¶1 – Gamma"]);
    expectCovers(text, chunks);
    expect(chunk("# Only\n## Headings", "T")).toEqual([
      {
        order: 0,
        text: "# Only\n## Headings",
        refLabel: "T › Only ¶1 – Headings",
      },
    ]);
  });

  it("joins a trailing heading only up to MAX_CHUNK_WORDS", () => {
    // "## Alpha" and "## Gamma" are two words each.
    const fits = `${section("Alpha", MAX_CHUNK_WORDS - 4)}\n\n## Gamma`;
    expect(labels(chunk(fits, "T"))).toEqual(["T › Alpha ¶1 – Gamma"]);
    const over = `${section("Alpha", MAX_CHUNK_WORDS - 3)}\n\n## Gamma`;
    const chunks = chunk(over, "T");
    expect(labels(chunks)).toEqual(["T › Alpha ¶1", "T › Gamma ¶1"]);
    expect(chunks[1].text).toBe("## Gamma");
    expectCovers(over, chunks);
    expectSizes(chunks);
  });

  it("joins a trailing heading only up to MAX_CHUNK_CHARS", () => {
    const heading = "## 見出し"; // 6 characters, after two newlines
    const body = (n: number) => `## 本文\n\n${"漢".repeat(n)}`;
    const room = MAX_CHUNK_CHARS - "## 本文\n\n".length - 2 - heading.length;
    const fits = `${body(room)}\n\n${heading}`;
    expect(labels(chunk(fits, "T"))).toEqual(["T › 本文 ¶1 – 見出し"]);
    const over = `${body(room + 1)}\n\n${heading}`;
    const chunks = chunk(over, "T");
    expect(labels(chunks)).toEqual(["T › 本文 ¶1", "T › 見出し ¶1"]);
    expectCovers(over, chunks);
    expectSizes(chunks);
  });
});

describe("chunk: plain-text and PDF headings", () => {
  it("finds short title lines in text with blank lines", () => {
    const text = [
      "Lecture 9: Recursion",
      prose(200, "a"),
      "Example: factorial",
      prose(200, "b"),
    ].join("\n\n");
    expect(labels(chunk(text, "T"))).toEqual([
      "T › Lecture 9: Recursion ¶1",
      "T › Example: factorial ¶1",
    ]);
  });

  it("finds headings in PDF text with no blank lines, but not wrapped lines", () => {
    const text = [
      "Structure",
      wrap(prose(200, "a")),
      "Selective permeability",
      wrap(prose(200, "b")),
    ].join("\n");
    const chunks = chunk(text, "T");
    expect(labels(chunks)).toEqual([
      "T › Structure ¶1",
      "T › Selective permeability ¶1",
    ]);
    expectCovers(text, chunks);
  });

  it("doesn't take sentences, list items, mid-sentence lines or the last line as headings", () => {
    const text = [
      "Overview",
      prose(200, "a"),
      "Every method needs two parts:",
      "- Base case first",
      "1. Recursive case",
      "the calls never stop and",
      "the program runs out",
      "Thanks everyone!",
      prose(200, "b"),
      "Last line",
    ].join("\n");
    expect(labels(chunk(text, "T"))).toEqual([
      "T › Overview ¶1",
      "T › Overview ¶2",
    ]);
  });

  it("only uses Markdown headings when there are any", () => {
    const text = `Plain title\n\n${prose(200, "a")}\n\n${section("Alpha", 200)}`;
    expect(labels(chunk(text, "T"))).toEqual(["T ¶1", "T › Alpha ¶1"]);
  });
});

describe("chunk: no headings", () => {
  it("packs paragraphs up to MAX_CHUNK_WORDS, labelled with the title", () => {
    const text = Array.from({ length: 10 }, (_, i) =>
      prose(100, `p${i}_`),
    ).join("\n\n");
    const chunks = chunk(text, "Notes");
    expect(labels(chunks)).toEqual(["Notes ¶1", "Notes ¶2", "Notes ¶3"]);
    expect(chunks.map((c) => countWords(c.text))).toEqual([400, 400, 200]);
    expectCovers(text, chunks);
  });
});

describe("chunk: sizes", () => {
  it("splits one giant line with no punctuation by words", () => {
    const text = Array.from({ length: 50_000 }, (_, i) => `w${i}`).join(" ");
    const chunks = chunk(text, "T");
    expect(chunks).toHaveLength(Math.ceil(50_000 / MAX_CHUNK_WORDS));
    expect(chunks.every((c) => countWords(c.text) === MAX_CHUNK_WORDS)).toBe(
      true,
    );
    expectCovers(text, chunks);
  });

  it("splits a very long paragraph at sentence ends", () => {
    const text = prose(1_000, "s");
    const chunks = chunk(text, "T");
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks.every((c) => c.text.endsWith("."))).toBe(true);
    expectCovers(text, chunks);
    expectSizes(chunks);
  });

  it("splits a sentence longer than MAX_CHUNK_WORDS by words, keeping its neighbours", () => {
    const giant = Array.from({ length: 900 }, (_, i) => `g${i}`).join(" ");
    const text = `Before it. ${giant}. After it.`;
    const chunks = chunk(text, "T");
    expectCovers(text, chunks);
    expectSizes(chunks);
    expect(chunks[0].text.startsWith("Before it. g0")).toBe(true);
    expect(chunks.at(-1)?.text.endsWith("g899. After it.")).toBe(true);
  });

  it("caps chunks by characters for text with no spaces", () => {
    const text = "日本語のノートです。".repeat(1_000);
    const chunks = chunk(text, "T");
    expect(chunks).toHaveLength(Math.ceil(text.length / MAX_CHUNK_CHARS));
    expect(chunks.map((c) => c.text).join("")).toBe(text);
    expectSizes(chunks);
  });

  it("returns a tiny document as one chunk, and nothing for empty text", () => {
    expect(chunk("Hello world.", "T")).toEqual([
      { order: 0, text: "Hello world.", refLabel: "T ¶1" },
    ]);
    expect(chunk("", "T")).toEqual([]);
    expect(chunk(" \n\t\n ", "T")).toEqual([]);
  });

  it("keeps the content right around each chunk boundary", () => {
    const text = [section("Alpha", 395), section("Beta", 395)].join("\n\n");
    const chunks = chunk(text, "T");
    expect(chunks).toHaveLength(2);
    expect(chunks[0].text.endsWith("Alpha394.")).toBe(true);
    expect(chunks[1].text.startsWith("## Beta\n\nBeta0 ")).toBe(true);
    const giant = Array.from({ length: 801 }, (_, i) => `w${i}`).join(" ");
    const parts = chunk(giant, "T").map((c) => c.text.split(" "));
    expect(parts.map((p) => [p[0], p.at(-1)])).toEqual([
      ["w0", "w399"],
      ["w400", "w799"],
      ["w800", "w800"],
    ]);
  });
});

describe("chunk: Unicode", () => {
  const whole = (texts: string[], grapheme: string) =>
    texts.every((t) =>
      Array.from(graphemes.segment(t)).every((g) => g.segment === grapheme),
    );

  it.each([
    ["a joined family emoji (11 code units)", "👨‍👩‍👧‍👦"],
    ["a flag (4 code units)", "🇨🇦"],
    ["a letter with two combining marks", "ẹ́"],
    ["a skin-tone emoji", "👋🏽"],
  ])("never splits %s when cutting by characters", (_, grapheme) => {
    const text = grapheme.repeat(
      Math.ceil((MAX_CHUNK_CHARS * 2.5) / grapheme.length),
    );
    const chunks = chunk(text, "T");
    expect(chunks.length).toBeGreaterThan(1);
    expect(
      whole(
        chunks.map((c) => c.text),
        grapheme,
      ),
    ).toBe(true);
    expect(chunks.map((c) => c.text).join("")).toBe(text);
    expectSizes(chunks);
  });

  it("keeps one grapheme longer than the cap whole rather than breaking it", () => {
    const zalgo = `e${"́".repeat(MAX_CHUNK_CHARS + 10)}`;
    const text = `before ${zalgo} after`;
    const chunks = chunk(text, "T");
    expect(chunks.some((c) => c.text === zalgo)).toBe(true);
    expectCovers(text, chunks);
  });

  it("keeps accents, NBSP, right-to-left and CJK text exactly", () => {
    const text = "Café naïve — שלום עולם — مرحبا بالعالم — 日本語のノート ✅";
    expect(chunk(text, "T")).toEqual([{ order: 0, text, refLabel: "T ¶1" }]);
  });

  it("finds headings in other scripts", () => {
    const text = `Введение\n\n${prose(200, "a")}\n\n概要\n\n${prose(200, "b")}`;
    expect(labels(chunk(text, "T"))).toEqual([
      "T › Введение ¶1",
      "T › 概要 ¶1",
    ]);
  });
});

describe("chunk: labels", () => {
  it("collapses whitespace in the title and heading", () => {
    const text = `##   Big \t  idea\n\n${prose(10, "a")}`;
    expect(labels(chunk(text, "  Week\n 4  "))).toEqual([
      "Week 4 › Big idea ¶1",
    ]);
  });

  it("cuts a long title and long headings at a grapheme boundary", () => {
    const title = "T".repeat(300);
    const heading = "🧬".repeat(100);
    const text = `## ${heading}\n\n${prose(20, "a")}\n\n## ${"H".repeat(100)}\n\n${prose(20, "b")}`;
    const [{ refLabel }] = chunk(text, title);
    const [titlePart, rest] = refLabel.split(" › ");
    const [first, last] = rest.split(" ¶1 – ");
    expect(titlePart).toBe(`${"T".repeat(MAX_LABEL_TITLE_CHARS - 1)}…`);
    expect(first.length).toBeLessThanOrEqual(MAX_LABEL_HEADING_CHARS);
    expect(first.endsWith("🧬…")).toBe(true);
    expect(last).toBe(`${"H".repeat(MAX_LABEL_HEADING_CHARS - 1)}…`);
    expect(refLabel.isWellFormed()).toBe(true);
  });

  // A heading near the note size limit starts about 250 chunks. Cleaning it up for every chunk's
  // label took ~650 ms of blocking CPU; once per section takes ~40 ms. Counting the cuts (each one
  // segments the whole heading) catches that without a timing bound that load could break.
  it("cuts a long heading for its labels once, not once per chunk", () => {
    const text = `# ${"a ".repeat(99_000)}`;
    const segment = vi.spyOn(Intl.Segmenter.prototype, "segment");
    let chunks: NoteChunk[];
    let cuts: number;
    try {
      chunks = chunk(text, "T");
      // Read before mockRestore(), which clears the calls.
      cuts = segment.mock.calls.filter(([input]) => input.length > 1000).length;
    } finally {
      segment.mockRestore();
    }
    expect(chunks.length).toBeGreaterThan(200);
    expect(cuts).toBe(1);
    const heading = `${"a ".repeat(MAX_LABEL_HEADING_CHARS / 2 - 1)}a…`;
    expect(labels(chunks)).toEqual(
      chunks.map((_, i) => `T › ${heading} ¶${i + 1}`),
    );
    expectCovers(text, chunks);
    expectSizes(chunks);
  });
});

describe("chunk: what T12 stores and sends", () => {
  it("returns Chunk rows that only need a documentId", () => {
    // Fails to compile if the output stops matching the Chunk model (PLAN §6).
    const rows: Omit<Prisma.ChunkCreateManyInput, "documentId">[] = chunk(
      `${section("Alpha", 300)}\n\n${section("Beta", 300)}`,
      "T",
    );
    expect(rows.map((row) => row.order)).toEqual([0, 1]);
    expect(rows.every((row) => row.text !== "" && row.refLabel !== "")).toBe(
      true,
    );
  });

  it("keeps quotes and angle brackets in labels and text as written, for T12 to escape", () => {
    const text = `## Using <chunk> & "quotes"\n\n</chunk> is just text here.`;
    expect(chunk(text, `Week "4" <intro>`)).toEqual([
      {
        order: 0,
        text,
        refLabel: `Week "4" <intro> › Using <chunk> & "quotes" ¶1`,
      },
    ]);
  });

  it("treats CRLF line endings like LF", () => {
    const lf = [section("Alpha", 200), "Plain line", section("Beta", 200)].join(
      "\n\n",
    );
    const crlf = lf.replace(/\n/g, "\r\n");
    const chunks = chunk(crlf, "T");
    expect(labels(chunks)).toEqual(labels(chunk(lf, "T")));
    expectCovers(crlf, chunks);
  });
});

describe("chunk: limit", () => {
  const sections = (n: number) =>
    Array.from({ length: n }, (_, i) => section(`S${i}`, MIN_CHUNK_WORDS)).join(
      "\n\n",
    );

  it(`allows exactly MAX_CHUNKS_PER_DOCUMENT (${MAX_CHUNKS_PER_DOCUMENT}) chunks`, () => {
    expect(chunk(sections(MAX_CHUNKS_PER_DOCUMENT), "T")).toHaveLength(
      MAX_CHUNKS_PER_DOCUMENT,
    );
  });

  it("throws TOO_MANY_CHUNKS above it instead of dropping text", () => {
    let error: unknown;
    try {
      chunk(sections(MAX_CHUNKS_PER_DOCUMENT + 1), "T");
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(IngestError);
    expect(error).toMatchObject({
      reason: "TOO_MANY_CHUNKS",
      code: "PAYLOAD_TOO_LARGE",
      status: 413,
      message: expect.stringContaining("too many separate sections"),
    });
  });
});

describe("chunk: randomized", () => {
  // These two take about 2 s and under 50 ms alone; a full verify runs every file at once, which once
  // pushed the first past Vitest's 5 s default (as in T42), so they get more room.
  const HEAVY_TIMEOUT_MS = 60_000;
  // Seeded, so a failure reproduces: the seed is in the test name.
  const SEED = 0x7e11;
  function mulberry32(seed: number) {
    let s = seed;
    return () => {
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function randomDocument(random: () => number, n: number): string {
    const int = (min: number, max: number) =>
      min + Math.floor(random() * (max - min + 1));
    const pick = <T>(items: readonly T[]) => items[int(0, items.length - 1)];
    const markdown = random() < 0.5;
    const blocks = Array.from({ length: int(1, 25) }, (_, b) => {
      const tag = `d${n}b${b}_`;
      return pick<() => string>([
        () =>
          markdown ? `${"#".repeat(int(1, 6))} Heading ${b}` : `Heading ${b}`,
        () => prose(int(1, 150), tag),
        () => wrap(prose(int(50, 300), tag), int(5, 15)),
        () =>
          Array.from({ length: int(400, 1200) }, (_, i) => `${tag}${i}`).join(
            " ",
          ),
        () => "漢字かなカナ。".repeat(int(100, 1500)),
        () => pick(["👨‍👩‍👧‍👦", "é", "🇨🇦", "a"]).repeat(int(10, 2000)),
        () => "```\n# code\n\nmore code\n```",
      ])();
    });
    return blocks
      .map((block, i) =>
        i === 0 ? block : pick(["\n", "\n\n", "\n \n\t", "\n\n\n"]) + block,
      )
      .join("");
  }

  it(
    `300 random documents are covered exactly, in size, and deterministically (seed ${SEED})`,
    () => {
      const random = mulberry32(SEED);
      for (let n = 0; n < 300; n++) {
        const text = randomDocument(random, n);
        const chunks = chunk(text, `Doc ${n}`);
        const offsets = expectCovers(text, chunks);
        expectSizes(chunks);
        expect(chunk(text, `Doc ${n}`)).toEqual(chunks);
        const boundaries = new Set(
          Array.from(graphemes.segment(text), (g) => g.index),
        ).add(text.length);
        expect(
          offsets.filter((offset) => !boundaries.has(offset)),
          "chunks start and end between graphemes",
        ).toEqual([]);
        for (const c of chunks) {
          expect(c.refLabel.isWellFormed()).toBe(true);
          expect(c.refLabel.length).toBeLessThanOrEqual(
            MAX_LABEL_TITLE_CHARS + 2 * MAX_LABEL_HEADING_CHARS + 20,
          );
          expect(c.refLabel).not.toMatch(/\n/);
        }
      }
    },
    HEAVY_TIMEOUT_MS,
  );

  // Each line targets a pattern that could backtrack: a heading's closing #s after a long run of
  // spaces, a long run of sentence ends, closing brackets after a full stop, and many tiny words.
  // Linear code takes under 50 ms here; a backtracking regex for the #s alone takes over 10 s.
  it(
    "handles a worst-case document at the note size limit quickly",
    () => {
      const hostile = [
        `## a${" ".repeat(150_000)}#b`,
        ".".repeat(20_000),
        `${")".repeat(10_000)}.`,
        "a ".repeat(9_000),
      ].join("\n");
      expect(hostile.length).toBeLessThanOrEqual(200_000);
      const started = performance.now();
      const chunks = chunk(hostile, "T");
      expect(performance.now() - started).toBeLessThan(3_000);
      expectCovers(hostile, chunks);
    },
    HEAVY_TIMEOUT_MS,
  );
});

describe("chunk: real notes", () => {
  const note = (name: string) =>
    readFileSync(path.join(FIXTURES, name), "utf8");

  it("chunks the Markdown fixture by its headings", () => {
    const text = note("tcp-basics.md");
    const chunks = chunk(text, "TCP basics");
    expect(labels(chunks)).toEqual([
      "TCP basics › Networks — Week 4: TCP basics ¶1 – Flow control vs. congestion control",
      "TCP basics › Teardown ¶1",
    ]);
    expectCovers(text, chunks);
  });

  it("chunks the plain-text fixture", () => {
    const text = note("recursion.txt");
    const chunks = chunk(text, "Recursion");
    expect(labels(chunks)).toEqual([
      "Recursion › CSE 143 - Lecture 9: Recursion ¶1 – Example: factorial",
    ]);
    expectCovers(text, chunks);
  });

  it("chunks text extracted from the PDF fixture", () => {
    // What extractText returns for fixtures/notes/cell-biology.pdf (no blank lines, mid-word wraps).
    const text =
      "BIOL 180 - Lecture 6: The Cell Membrane and Transport\nStructure\nThe plasma membrane is a phospholipid bilayer. Each phospholipid has a hydrophil\nic head and two hydrophobic fatty acid tails, so the tails face inward and the h\neads face the water on both sides. Proteins embedded in the bilayer move lateral\nly; this is the fluid mosaic model. Cholesterol keeps the membrane fluid at low\ntemperatures and limits movement at high temperatures.\nSelective permeability\nSmall nonpolar molecules (O2, CO2) cross the bilayer directly. Ions and large po\nlar molecules (glucose) need transport proteins.\nPassive transport (no energy required)\n- Diffusion: molecules move down their concentration gradient.\n- Osmosis: water diffuses across a membrane toward the side with more solute.\n- Facilitated diffusion: channel or carrier proteins help molecules move down th\neir gradient, for example aquaporins for water.\nTonicity\nA cell in a hypotonic solution gains water (animal cells may lyse; plant cells b\necome turgid). In a hypertonic solution the cell loses water (plasmolysis in pla\nnt cells). An isotonic solution causes no net movement.\nActive transport (requires ATP)\nThe sodium-potassium pump moves 3 Na+ out and 2 K+ in per ATP, against both grad\nients. This builds the membrane potential that nerve cells use to send signals.\nBulk transport\nExocytosis releases materials using vesicles that fuse with the membrane. Endocy\ntosis takes materials in: phagocytosis (cell eating), pinocytosis (cell drinking\n), and receptor-mediated endocytosis, which is specific to the molecules bound b\ny receptors.";
    const chunks = chunk(text, "Cell membrane");
    expect(labels(chunks)).toEqual([
      "Cell membrane ¶1 – Tonicity",
      "Cell membrane › Active transport (requires ATP) ¶1 – Bulk transport",
    ]);
    expectCovers(text, chunks);
  });
});
