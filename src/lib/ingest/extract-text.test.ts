import { readFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { IngestError, type IngestErrorReason } from "./errors";
import {
  extractText,
  ingestLimits,
  MAX_PDF_PAGES,
  normalizeNoteText,
} from "./extract-text";

const FIXTURES = path.resolve(import.meta.dirname, "../../../fixtures/notes");
const fixture = (name: string) =>
  new Uint8Array(readFileSync(path.join(FIXTURES, name)));
const bytes = (text: string) => new TextEncoder().encode(text);

const STATUS = {
  UNSUPPORTED_TYPE: 400,
  PAYLOAD_TOO_LARGE: 413,
  UNREADABLE_FILE: 422,
} as const;

async function expectIngestError(
  promise: Promise<unknown>,
  code: keyof typeof STATUS,
  reason: IngestErrorReason,
): Promise<IngestError> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(IngestError);
  const ingest = error as IngestError;
  expect({
    code: ingest.code,
    status: ingest.status,
    reason: ingest.reason,
  }).toEqual({
    code,
    status: STATUS[code],
    reason,
  });
  return ingest;
}

/**
 * A minimal valid PDF, one string of ASCII text per page (empty string = no text layer).
 * Each "\n" starts a new line, since PDF.js drops text that runs off the page.
 */
function buildPdf(pages: string[]): Uint8Array {
  const escape = (s: string) => s.replace(/[\\()]/g, "\\$&");
  const kids = pages.map((_, i) => `${4 + i * 2} 0 R`).join(" ");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  pages.forEach((text, i) => {
    const lines = text
      .split("\n")
      .map((line) => `(${escape(line)}) Tj T*`)
      .join(" ");
    const stream = text ? `BT /F1 12 Tf 14 TL 72 720 Td ${lines} ET` : "";
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`,
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    );
  });
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets
    .map((o) => `${String(o).padStart(10, "0")} 00000 n \n`)
    .join("");
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return bytes(out);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("extractText: real notes", () => {
  it("reads a .txt note and keeps tabs and newlines", async () => {
    const text = await extractText(fixture("recursion.txt"), "recursion.txt");
    expect(text).toContain("Base case: the simplest input");
    expect(text).toContain("\n\tfactorial(0) = 1\n");
  });

  it("reads a .md note, keeping non-ASCII characters", async () => {
    const text = await extractText(fixture("tcp-basics.md"), "tcp-basics.md");
    expect(text).toContain("## Connection setup: the three-way handshake");
    expect(text).toContain("Client → server");
  });

  it("reads a text PDF", async () => {
    const text = await extractText(
      fixture("cell-biology.pdf"),
      "cell-biology.pdf",
    );
    expect(text).toContain("Selective permeability");
    expect(text).toContain("phospholipid");
    expect(text).not.toMatch(/[\u0000-\u0008\u000b-\u001f\u007f]/);
  });

  it("matches the extension case-insensitively", async () => {
    await expect(
      extractText(fixture("cell-biology.pdf"), "NOTES.PDF"),
    ).resolves.toContain("Selective permeability");
    await expect(extractText(bytes("# Hi"), "Week1.MD")).resolves.toBe("# Hi");
  });
});

describe("extractText: hostile uploads", () => {
  it("rejects a text file renamed to .pdf (400)", async () => {
    await expectIngestError(
      extractText(fixture("hostile/fake.pdf"), "fake.pdf"),
      "UNSUPPORTED_TYPE",
      "CONTENT_MISMATCH",
    );
  });

  it("rejects a binary renamed to .txt (400)", async () => {
    await expectIngestError(
      extractText(fixture("hostile/binary.png"), "binary.txt"),
      "UNSUPPORTED_TYPE",
      "CONTENT_MISMATCH",
    );
  });

  it("rejects PDF bytes uploaded as .txt (400)", async () => {
    await expectIngestError(
      extractText(fixture("cell-biology.pdf"), "notes.txt"),
      "UNSUPPORTED_TYPE",
      "CONTENT_MISMATCH",
    );
  });

  it("rejects invalid UTF-8 (400)", async () => {
    await expectIngestError(
      extractText(fixture("hostile/invalid-utf8.txt"), "invalid-utf8.txt"),
      "UNSUPPORTED_TYPE",
      "INVALID_TEXT_ENCODING",
    );
  });

  it("rejects an empty file (422)", async () => {
    await expectIngestError(
      extractText(fixture("hostile/empty.txt"), "empty.txt"),
      "UNREADABLE_FILE",
      "NO_TEXT",
    );
  });

  it("rejects a whitespace-only file (422)", async () => {
    await expectIngestError(
      extractText(bytes(" \n\t\r\n "), "blank.md"),
      "UNREADABLE_FILE",
      "NO_TEXT",
    );
  });

  it("rejects a scanned PDF with no text layer (422)", async () => {
    await expectIngestError(
      extractText(fixture("hostile/scanned.pdf"), "scanned.pdf"),
      "UNREADABLE_FILE",
      "NO_TEXT",
    );
  });

  it("rejects a PDF with only blank pages (422)", async () => {
    await expectIngestError(
      extractText(buildPdf(["", ""]), "blank.pdf"),
      "UNREADABLE_FILE",
      "NO_TEXT",
    );
  });

  it("rejects a corrupt PDF behind a valid header (422)", async () => {
    await expectIngestError(
      extractText(bytes("%PDF-1.7\nÿþ not really a pdf"), "broken.pdf"),
      "UNREADABLE_FILE",
      "UNREADABLE_PDF",
    );
  });

  it.each(["notes.docx", "notes.exe", "notes", "notes.pdf.exe", ".env"])(
    "rejects the extension of %s (400)",
    async (filename) => {
      await expectIngestError(
        extractText(bytes("hello"), filename),
        "UNSUPPORTED_TYPE",
        "UNSUPPORTED_EXTENSION",
      );
    },
  );

  it("never puts the filename, the file's text or parser output in the message", async () => {
    const cases: [Uint8Array, string][] = [
      [bytes("SECRET-NOTE plain text"), "SECRET-NAME.pdf"],
      [bytes("SECRET-NOTE \u0000 binary"), "SECRET-NAME.txt"],
      [
        new Uint8Array([...bytes("SECRET-NOTE "), 0xc3, 0x28]),
        "SECRET-NAME.md",
      ],
      [bytes("%PDF-1.7 SECRET-NOTE"), "SECRET-NAME.pdf"],
      [bytes("SECRET-NOTE"), "SECRET-NAME.docx"],
    ];
    for (const [data, filename] of cases) {
      const error = await extractText(data, filename).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(IngestError);
      expect((error as Error).message).not.toMatch(
        /SECRET|pdf\.js|Invalid PDF/i,
      );
      expect((error as Error).cause).toBeUndefined();
    }
  });
});

describe("extractText: limits", () => {
  it("rejects a file over MAX_UPLOAD_MB before parsing it (413)", async () => {
    const over = new Uint8Array(4 * 1024 * 1024 + 1);
    over.set(bytes("%PDF-1.7 garbage that would be a 422 if parsed"));
    const error = await expectIngestError(
      extractText(over, "big.pdf"),
      "PAYLOAD_TOO_LARGE",
      "FILE_TOO_LARGE",
    );
    expect(error.message).toContain("4 MB");
  });

  it("reads MAX_UPLOAD_MB from the environment", async () => {
    vi.stubEnv("MAX_UPLOAD_MB", "1");
    await expectIngestError(
      extractText(new Uint8Array(1024 * 1024 + 1).fill(0x61), "big.txt"),
      "PAYLOAD_TOO_LARGE",
      "FILE_TOO_LARGE",
    );
  });

  it("accepts text at exactly MAX_NOTE_CHARS and rejects one more (413)", async () => {
    const max = 200_000;
    await expect(
      extractText(bytes("a".repeat(max)), "max.txt"),
    ).resolves.toHaveLength(max);
    const error = await expectIngestError(
      extractText(bytes("a".repeat(max + 1)), "over.txt"),
      "PAYLOAD_TOO_LARGE",
      "TEXT_TOO_LONG",
    );
    expect(error.message).toContain("200,000-character limit");
  });

  it("counts characters after normalization", async () => {
    const text = "a".repeat(200_000) + "\u0007\u001b".repeat(100);
    await expect(extractText(bytes(text), "notes.txt")).resolves.toHaveLength(
      200_000,
    );
  });

  it("rejects a PDF whose text is over MAX_NOTE_CHARS (413)", async () => {
    vi.stubEnv("MAX_NOTE_CHARS", "1000");
    // 600 characters a page: the second page passes the limit, so the third is never read.
    const pages = Array.from({ length: 3 }, () =>
      Array.from({ length: 12 }, () => "words".repeat(10)).join("\n"),
    );
    await expectIngestError(
      extractText(buildPdf(pages), "long.pdf"),
      "PAYLOAD_TOO_LARGE",
      "TEXT_TOO_LONG",
    );
  });

  it(`accepts a PDF with exactly ${MAX_PDF_PAGES} pages`, async () => {
    const pages = Array.from(
      { length: MAX_PDF_PAGES },
      (_, i) => `Page ${i + 1}`,
    );
    const text = await extractText(buildPdf(pages), "100.pdf");
    expect(text).toMatch(/^Page 1\n\nPage 2\n\n/);
    expect(text).toContain("Page 100");
  });

  it(`rejects a PDF with more than ${MAX_PDF_PAGES} pages, explaining the limit (413)`, async () => {
    const pages = Array.from(
      { length: MAX_PDF_PAGES + 1 },
      (_, i) => `Page ${i + 1}`,
    );
    const error = await expectIngestError(
      extractText(buildPdf(pages), "101.pdf"),
      "PAYLOAD_TOO_LARGE",
      "TOO_MANY_PAGES",
    );
    expect(error.message).toBe(
      "PDFs can have at most 100 pages. Split this file into smaller parts and upload each one.",
    );
  });

  it("uses the PLAN §7 defaults when the variables are unset", () => {
    vi.stubEnv("MAX_UPLOAD_MB", "");
    vi.stubEnv("MAX_NOTE_CHARS", "");
    expect(ingestLimits()).toEqual({
      maxUploadMb: 4,
      maxNoteChars: 200_000,
      maxPdfPages: 100,
    });
  });

  it.each(["0", "-1", "1.5", "4MB", "abc"])(
    "throws on a malformed limit (%s)",
    (value) => {
      vi.stubEnv("MAX_NOTE_CHARS", value);
      expect(() => ingestLimits()).toThrow(
        "MAX_NOTE_CHARS must be a positive integer",
      );
    },
  );
});

describe("normalizeNoteText", () => {
  it("normalizes to NFC", () => {
    const nfd = "café résumé";
    expect(normalizeNoteText(nfd)).toBe("café résumé");
    expect(normalizeNoteText(nfd)).toBe(
      normalizeNoteText(nfd).normalize("NFC"),
    );
  });

  it("strips control characters but keeps newlines and tabs", () => {
    expect(
      normalizeNoteText("a\u0000b\u0007c\u001bd\u007fe\u0085f\u009bg\th\ni"),
    ).toBe("abcdefg\th\ni");
  });

  it("converts CRLF and CR line endings to LF", () => {
    expect(normalizeNoteText("one\r\ntwo\rthree\n")).toBe("one\ntwo\nthree\n");
  });

  it("strips a leading byte order mark", () => {
    expect(normalizeNoteText("﻿notes")).toBe("notes");
  });

  it("rejects text that is empty after normalization (422)", () => {
    expect(() => normalizeNoteText("\u0000\u0001 \n")).toThrow(IngestError);
  });

  it("enforces the limits it is given", () => {
    const limits = { maxUploadMb: 4, maxNoteChars: 5, maxPdfPages: 100 };
    expect(normalizeNoteText("12345", limits)).toBe("12345");
    expect(() => normalizeNoteText("123456", limits)).toThrow(
      expect.objectContaining({
        code: "PAYLOAD_TOO_LARGE",
        reason: "TEXT_TOO_LONG",
      }),
    );
  });
});
