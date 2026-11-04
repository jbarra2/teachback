import type { ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  extractText,
  ingestLimits,
  PDF_CHILD_HEAP_MB,
  PDF_MEMORY_BUDGET_MB,
  PDF_TIMEOUT_MS,
  readPdf,
} from "./extract-text";
import { MEMORY_WATCHDOG_INTERVAL_MS } from "./pdf-child";

// These start real child processes with real hostile PDFs, built in memory below.

// Records every child started, keeping the real fork, so a test can check they all ended.
const forked = vi.hoisted(() => [] as ChildProcess[]);
vi.mock("node:child_process", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:child_process")>();
  return {
    ...real,
    fork: (...args: Parameters<typeof real.fork>) => {
      const child = real.fork(...args);
      forked.push(child);
      return child;
    },
  };
});

afterEach(() => {
  forked.length = 0;
});

function expectAllChildrenGone() {
  expect(forked.length).toBeGreaterThan(0);
  for (const child of forked)
    expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
}

/** A PDF from raw objects: object n is `objects[n - 1]`; object 1 must be the catalog. */
function buildPdf(objects: (string | Buffer)[]): Uint8Array {
  const parts: Buffer[] = [Buffer.from("%PDF-1.4\n")];
  const offsets: number[] = [];
  let length = parts[0].length;
  objects.forEach((body, i) => {
    const part = Buffer.concat([
      Buffer.from(`${i + 1} 0 obj\n`),
      Buffer.isBuffer(body) ? body : Buffer.from(body),
      Buffer.from("\nendobj\n"),
    ]);
    offsets.push(length);
    parts.push(part);
    length += part.length;
  });
  parts.push(
    Buffer.from(
      `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
        offsets
          .map((o) => `${String(o).padStart(10, "0")} 00000 n \n`)
          .join("") +
        `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`,
    ),
  );
  return new Uint8Array(Buffer.concat(parts));
}

const stream = (data: Buffer) =>
  Buffer.concat([
    Buffer.from(`<< /Length ${data.length} /Filter /FlateDecode >>\nstream\n`),
    data,
    Buffer.from("\nendstream"),
  ]);

/**
 * `pages` pages that share one compressed content stream, drawn in Helvetica. With `toUnicode`,
 * the font's CMap maps the glyph "A" to that text (hex UTF-16), however long.
 */
function pdfWithContent(
  content: Buffer,
  pages = 1,
  toUnicode?: string,
): Uint8Array {
  const kids = Array.from({ length: pages }, (_, i) => `${5 + i} 0 R`).join(
    " ",
  );
  const cmap = toUnicode
    ? `/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CMapName /X def 1 begincodespacerange <00> <FF> endcodespacerange 1 beginbfchar <41> <${toUnicode}> endbfchar endcmap CMapName currentdict /CMap defineresource pop end end`
    : "";
  return buildPdf([
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${kids}] /Count ${pages} >>`,
    `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica${toUnicode ? " /ToUnicode 4 0 R" : ""} >>`,
    stream(deflateSync(cmap)),
    ...Array.from(
      { length: pages },
      () =>
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + pages} 0 R >>`,
    ),
    stream(deflateSync(content)),
  ]);
}

const hex = (text: string) =>
  [...text].map((c) => c.charCodeAt(0).toString(16).padStart(4, "0")).join("");

function watchHeartbeat() {
  let last = performance.now();
  let maxGap = 0;
  const timer = setInterval(() => {
    const now = performance.now();
    maxGap = Math.max(maxGap, now - last);
    last = now;
  }, 25);
  // The gap still open when it stops counts too: a fully blocked loop never ticks at all.
  return () => {
    clearInterval(timer);
    return Math.max(maxGap, performance.now() - last);
  };
}

const cellBiology = () =>
  new Uint8Array(readFileSync("fixtures/notes/cell-biology.pdf"));

describe("PDF parsing in a child process", () => {
  it("has the agreed caps", () => {
    expect(PDF_TIMEOUT_MS).toBe(15_000);
    expect(PDF_CHILD_HEAP_MB).toBe(256);
    expect(PDF_MEMORY_BUDGET_MB).toBe(512);
    expect(MEMORY_WATCHDOG_INTERVAL_MS).toBe(20);
  });

  it("kills a PDF that keeps the parser busy, without blocking the event loop", async () => {
    // One page whose 32 MB of text operators compress to well under 200 KB. In-process, PDF.js
    // blocked the event loop for seconds on it.
    const line = "BT /F1 12 Tf 72 712 Td (A) Tj ET\n";
    const pdf = pdfWithContent(
      Buffer.from(line.repeat(Math.ceil((32 * 1024 * 1024) / line.length))),
    );
    expect(pdf.byteLength).toBeLessThan(200 * 1024);
    const stop = watchHeartbeat();
    const started = performance.now();

    const error = await readPdf(pdf, ingestLimits(), {
      timeoutMs: 1000,
      memoryBudgetMb: 4096,
    }).catch((e: unknown) => e);

    expect(stop()).toBeLessThan(1000);
    expect(error).toMatchObject({ status: 422, reason: "UNREADABLE_PDF" });
    expect(performance.now() - started).toBeLessThan(6000);
    expectAllChildrenGone();
  });

  it("survives a 1 KB PDF that makes V8 abort, and keeps working", async () => {
    // A glyph mapped to 30,000 characters, drawn 1,000 times: PDF.js runs out of heap in native
    // code, which aborts the whole process. With a worker thread, that was the server.
    const pdf = pdfWithContent(
      Buffer.from(`BT /F1 1 Tf 0 0 Td (${"A".repeat(1000)}) Tj ET`),
      1,
      hex("a".repeat(30_000)),
    );
    expect(pdf.byteLength).toBeLessThan(2 * 1024);

    await expect(
      readPdf(pdf, ingestLimits(), { memoryBudgetMb: 4096 }),
    ).rejects.toMatchObject({ status: 422, reason: "UNREADABLE_PDF" });
    expectAllChildrenGone();
    // V8's fatal error aborted the child, not the time cap or the watchdog.
    expect(forked[0].signalCode).toBe("SIGABRT");
    await expect(
      extractText(cellBiology(), "cell-biology.pdf"),
    ).resolves.toContain("Selective permeability");
  });

  it("kills a PDF that grows past the memory budget, long before the time cap", async () => {
    // 256 MB of spaces in one content stream: PDF.js decodes it into ArrayBuffers that V8's heap
    // limit doesn't count. The watchdog thread in the child sees them in the process's RSS.
    const pdf = pdfWithContent(Buffer.alloc(256 * 1024 * 1024, 0x20));
    expect(pdf.byteLength).toBeLessThan(1024 * 1024);
    const started = performance.now();

    await expect(
      readPdf(pdf, ingestLimits(), {
        memoryBudgetMb: 128,
        timeoutMs: PDF_TIMEOUT_MS,
      }),
    ).rejects.toMatchObject({ status: 422, reason: "UNREADABLE_PDF" });
    expect(performance.now() - started).toBeLessThan(5000);
    expectAllChildrenGone();
  });

  it("never hands the server more than the note limit, however much whitespace a PDF holds", async () => {
    // Glyphs mapped to a control character plus 2,000 spaces: PDF.js keeps them as text, and
    // once the control character is stripped it's all whitespace, 100 pages of it.
    const pdf = pdfWithContent(
      Buffer.from(`BT /F1 0.001 Tf 0 0 Td (${"A".repeat(100)}) Tj ET`),
      100,
      hex("\u0001" + " ".repeat(2000)),
    );
    expect(pdf.byteLength).toBeLessThan(32 * 1024);

    await expect(readPdf(pdf, ingestLimits())).resolves.toBe("");
    await expect(extractText(pdf, "blank.pdf")).rejects.toMatchObject({
      status: 422,
      reason: "NO_TEXT",
    });
    expectAllChildrenGone();
  });

  it("ends the child after a normal PDF too", async () => {
    await expect(
      extractText(cellBiology(), "cell-biology.pdf"),
    ).resolves.toContain("phospholipid");
    expectAllChildrenGone();
  });
});
