import { getDocumentProxy } from "unpdf";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CombiningRunError,
  MAX_COMBINING_RUN,
  normalizeText,
  readPdfText,
} from "./pdf-child";

/** A base letter followed by `count` combining marks, cycling through several kinds. */
function markRun(count: number): string {
  const marks = ["́", "̀", "̂", "̃", "̈", "̧"];
  return (
    "a" +
    Array.from({ length: count }, (_, i) => marks[i % marks.length]).join("")
  );
}

// readPdfText runs in-process here, with PDF.js mocked, to test the child's logic directly.
vi.mock("unpdf", () => ({ getDocumentProxy: vi.fn() }));

type PdfDocument = Awaited<ReturnType<typeof getDocumentProxy>>;
const mockedGetDocumentProxy = vi.mocked(getDocumentProxy);
const PDF = new TextEncoder().encode("%PDF-1.7\nmocked");

/** A document whose pages hold the given text, one text item per page. */
function fakeDocument(pages: string[]) {
  const destroy = vi.fn(() => Promise.resolve());
  const getPage = vi.fn((n: number) =>
    Promise.resolve({
      getTextContent: () =>
        Promise.resolve({
          // A marked-content item (no `str`) carries no text and is skipped.
          items: [
            { type: "beginMarkedContent" },
            { str: pages[n - 1], hasEOL: false },
          ],
        }),
    }),
  );
  const doc = {
    numPages: pages.length,
    getPage,
    loadingTask: { destroy },
  } as unknown as PdfDocument;
  mockedGetDocumentProxy.mockResolvedValue(doc);
  return { getPage, destroy };
}

afterEach(() => {
  mockedGetDocumentProxy.mockReset();
});

describe("readPdfText", () => {
  it("joins the pages' text with blank lines", async () => {
    const { destroy } = fakeDocument(["One", "Two"]);
    await expect(
      readPdfText(PDF, { maxPdfPages: 100, maxNoteChars: 100 }),
    ).resolves.toEqual({
      text: "One\n\nTwo",
    });
    expect(destroy).toHaveBeenCalled();
  });

  it("rejects too many pages without reading any", async () => {
    const { getPage } = fakeDocument(["a", "b", "c"]);
    await expect(
      readPdfText(PDF, { maxPdfPages: 2, maxNoteChars: 100 }),
    ).resolves.toEqual({
      reason: "TOO_MANY_PAGES",
    });
    expect(getPage).not.toHaveBeenCalled();
  });

  it("stops reading pages once the text passes the note limit", async () => {
    const { getPage, destroy } = fakeDocument(Array(5).fill("a".repeat(600)));
    await expect(
      readPdfText(PDF, { maxPdfPages: 100, maxNoteChars: 1000 }),
    ).resolves.toEqual({
      reason: "TEXT_TOO_LONG",
    });
    expect(getPage).toHaveBeenCalledTimes(2);
    expect(destroy).toHaveBeenCalled();
  });

  it("counts characters, not UTF-16 units, when stopping early", async () => {
    // 500 + "\n\n" + 500 = 1002 characters, but 2002 UTF-16 units.
    fakeDocument(["𝑥".repeat(500), "𝑥".repeat(500)]);
    await expect(
      readPdfText(PDF, { maxPdfPages: 100, maxNoteChars: 1002 }),
    ).resolves.toEqual({
      text: "𝑥".repeat(500) + "\n\n" + "𝑥".repeat(500),
    });
  });

  it("doesn't count whitespace before the first text or after the last", async () => {
    fakeDocument([
      " ".repeat(2000),
      " ".repeat(2000) + "a",
      "b" + " ".repeat(2000),
      " \n ",
    ]);
    await expect(
      readPdfText(PDF, { maxPdfPages: 100, maxNoteChars: 4 }),
    ).resolves.toEqual({ text: "a\n\nb" });
  });

  it("counts whitespace between pages, which trimming keeps", async () => {
    fakeDocument(["a" + " ".repeat(2000), " ".repeat(2000) + "b"]);
    await expect(
      readPdfText(PDF, { maxPdfPages: 100, maxNoteChars: 1000 }),
    ).resolves.toEqual({ reason: "TEXT_TOO_LONG" });
  });

  it("never returns more than the limit, however much whitespace follows the text", async () => {
    fakeDocument(["a", ...Array<string>(50).fill(" ".repeat(100_000))]);
    const result = await readPdfText(PDF, {
      maxPdfPages: 100,
      maxNoteChars: 10,
    });
    expect(result).toEqual({ text: "a" });
  });

  it("matches pages.join('\\n\\n').trim() and its limit exactly (random pages, seeded)", async () => {
    let seed = 0x1010;
    const random = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x80000000;
    };
    const pieces = ["", " ", "\n", "\t  ", "word", "𝑥", "a b", "  z  "];
    for (let n = 0; n < 300; n++) {
      const pages = Array.from({ length: 1 + Math.floor(random() * 5) }, () =>
        Array.from(
          { length: Math.floor(random() * 4) },
          () => pieces[Math.floor(random() * pieces.length)],
        ).join(""),
      );
      const max = Math.floor(random() * 25);
      const expected = pages.join("\n\n").trim();
      const characters = [...expected].length;
      fakeDocument(pages);
      const result = await readPdfText(PDF, {
        maxPdfPages: 100,
        maxNoteChars: max,
      });
      expect(result, JSON.stringify({ pages, max })).toEqual(
        characters > max ? { reason: "TEXT_TOO_LONG" } : { text: expected },
      );
    }
  });

  it("normalizes each page's text", async () => {
    fakeDocument(["cafe\u0301\u0000 \uD800"]);
    await expect(
      readPdfText(PDF, { maxPdfPages: 100, maxNoteChars: 100 }),
    ).resolves.toEqual({
      text: "café \uFFFD",
    });
  });

  it("#69: answers UNUSUAL_TEXT for a page with a long run of combining marks", async () => {
    fakeDocument(["fine page", `text ${markRun(MAX_COMBINING_RUN + 1)} more`]);
    await expect(
      readPdfText(PDF, { maxPdfPages: 100, maxNoteChars: 1000 }),
    ).resolves.toEqual({ reason: "UNUSUAL_TEXT" });
  });

  it("answers only a reason when the parser fails, never its message", async () => {
    mockedGetDocumentProxy.mockRejectedValue(
      new Error("Invalid object 12: SECRET-NOTE text from the file"),
    );
    const result = await readPdfText(PDF, {
      maxPdfPages: 100,
      maxNoteChars: 100,
    });
    expect(result).toEqual({ reason: "UNREADABLE_PDF" });
    expect(JSON.stringify(result)).not.toMatch(/SECRET|Invalid object/);
  });

  it("frees the document when reading a page fails", async () => {
    const { getPage, destroy } = fakeDocument(["a"]);
    getPage.mockRejectedValue(new Error("bad page"));
    await expect(
      readPdfText(PDF, { maxPdfPages: 100, maxNoteChars: 100 }),
    ).resolves.toEqual({
      reason: "UNREADABLE_PDF",
    });
    expect(destroy).toHaveBeenCalled();
  });
});

// #69: NFC takes quadratic time on a long run of combining marks (100,000 marks block for seconds),
// so a run longer than UAX #15's Stream-Safe limit is refused before normalizing.
describe("normalizeText and combining marks (#69)", () => {
  it("normalizes a run of exactly 30 marks as before", () => {
    const text = markRun(MAX_COMBINING_RUN);
    expect(normalizeText(text)).toBe(text.normalize("NFC"));
  });

  it("refuses a run of 31 marks", () => {
    expect(() => normalizeText(markRun(MAX_COMBINING_RUN + 1))).toThrow(
      CombiningRunError,
    );
  });

  it("allows many short runs, each under the limit", () => {
    const text = Array.from({ length: 2000 }, () =>
      markRun(MAX_COMBINING_RUN),
    ).join(" ");
    expect(normalizeText(text)).toBe(text.normalize("NFC"));
  });

  it("refuses a huge run quickly instead of blocking", () => {
    const started = performance.now();
    expect(() => normalizeText(markRun(200_000))).toThrow(CombiningRunError);
    // NFC on this input takes many seconds; the refusal must not.
    expect(performance.now() - started).toBeLessThan(2_000);
  });

  it("counts marks across a BOM, line endings and lone surrogates the same way", () => {
    expect(() =>
      normalizeText(`﻿
${markRun(MAX_COMBINING_RUN + 1)}�`),
    ).toThrow(CombiningRunError);
  });
});
