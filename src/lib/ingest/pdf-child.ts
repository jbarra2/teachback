import { Worker } from "node:worker_threads";

import { getDocumentProxy } from "unpdf";

import type { IngestErrorReason } from "./errors";

// PDF.js runs here, in a child process that extract-text.ts kills at the time cap. A hostile PDF
// can keep PDF.js busy without yielding, allocate gigabytes of ArrayBuffers outside the V8 heap,
// or make V8 abort on a fatal out-of-memory error. In a child process each of those ends only the
// child; the server sees an exit and answers 422.
//
// Node runs this file directly (types stripped), in tests and in production, so it can only import
// packages, Node built-ins and types. That's why the text helpers live here too.

/** Marks the child in its argv, so importing this module elsewhere never starts listening. */
export const PDF_CHILD_FLAG = "--teachback-pdf-child";
/** How often the child's watchdog thread checks the process's memory. */
export const MEMORY_WATCHDOG_INTERVAL_MS = 20;

export interface PdfLimits {
  maxPdfPages: number;
  maxNoteChars: number;
}
export interface PdfRequest {
  data: Uint8Array;
  limits: PdfLimits;
  /** The child kills itself when its resident memory passes this. */
  memoryBudgetBytes: number;
}
export type PdfResult =
  | { text: string }
  | {
      reason: Extract<
        IngestErrorReason,
        "TOO_MANY_PAGES" | "TEXT_TOO_LONG" | "UNREADABLE_PDF"
      >;
    };

// Control characters (\p{Cc}: C0, DEL, C1) except newline and tab.
const CONTROL_CHARS = /[^\P{Cc}\n\t]/gu;
const SURROGATE_PAIR = /[\uD800-\uDBFF][\uDC00-\uDFFF]/g;

/**
 * BOM stripped, LF line endings, unpaired surrogates (which PostgreSQL refuses) replaced with
 * U+FFFD, NFC, and control characters removed. Not trimmed.
 */
export function normalizeText(text: string): string {
  return text
    .replace(/^﻿/, "")
    .replace(/\r\n?/g, "\n")
    .toWellFormed()
    .normalize("NFC")
    .replace(CONTROL_CHARS, "");
}

/** Length in characters (code points), as PostgreSQL's varchar and the zod schemas count. */
export function characterCount(text: string): number {
  return text.length - (text.match(SURROGATE_PAIR)?.length ?? 0);
}

/**
 * Builds `pages.join("\n\n").trim()` page by page, stopping as soon as it passes `max`
 * characters. Whitespace after the last non-blank text is held back and capped: kept in full it
 * could be huge (it's free until more text follows), and past the cap any later text is over
 * the limit anyway. `trim()` only removes single-unit characters, so lengths are counts here.
 */
class BoundedText {
  private core = "";
  private count = 0;
  private tail = "";
  // A plain field, not a constructor parameter property: Node's type stripping can't run those.
  private readonly max: number;

  constructor(max: number) {
    this.max = max;
  }

  /** Appends a page; false once the trimmed text is over the limit. */
  add(page: string): boolean {
    // Until there is text, everything before it is leading whitespace, which trim() removes.
    const piece = this.core === "" ? page.trimStart() : `\n\n${page}`;
    const text = piece.trimEnd();
    if (text === "") {
      this.holdBack(piece);
      return true;
    }
    this.count += this.tail.length + characterCount(text);
    this.core += this.tail + text;
    this.tail = "";
    this.holdBack(piece.slice(text.length));
    return this.count <= this.max;
  }

  get text(): string {
    return this.core;
  }

  private holdBack(whitespace: string) {
    const room = Math.max(0, this.max - this.count + 1);
    this.tail = (this.tail + whitespace).slice(0, room);
  }
}

/** Reads the text of every page, enforcing the page cap and stopping early past the note limit. */
export async function readPdfText(
  data: Uint8Array,
  limits: PdfLimits,
): Promise<PdfResult> {
  let doc: Awaited<ReturnType<typeof getDocumentProxy>> | undefined;
  try {
    doc = await getDocumentProxy(data, { verbosity: 0, stopAtErrors: true });
    if (doc.numPages > limits.maxPdfPages) return { reason: "TOO_MANY_PAGES" };

    const text = new BoundedText(limits.maxNoteChars);
    for (let n = 1; n <= doc.numPages; n++) {
      const content = await (await doc.getPage(n)).getTextContent();
      const page = normalizeText(
        content.items
          .map((item) =>
            "str" in item ? item.str + (item.hasEOL ? "\n" : "") : "",
          )
          .join(""),
      );
      if (!text.add(page)) return { reason: "TEXT_TOO_LONG" };
    }
    return { text: text.text };
  } catch {
    // Parser errors can quote the file, so only the reason leaves the child.
    return { reason: "UNREADABLE_PDF" };
  } finally {
    await doc?.loadingTask.destroy();
  }
}

// Runs on its own thread, so it keeps checking while PDF.js blocks the child's main thread. RSS is
// the whole process's memory, including PDF.js's ArrayBuffers, which V8's heap limit doesn't see.
const WATCHDOG = `
const { workerData } = require("node:worker_threads");
setInterval(() => {
  if (process.memoryUsage.rss() > workerData.budget) process.kill(process.pid, "SIGKILL");
}, workerData.interval);
`;

if (process.send && process.argv.includes(PDF_CHILD_FLAG)) {
  process.once("message", (request: PdfRequest) => {
    new Worker(WATCHDOG, {
      eval: true,
      workerData: {
        budget: request.memoryBudgetBytes,
        interval: MEMORY_WATCHDOG_INTERVAL_MS,
      },
    }).unref();
    void readPdfText(request.data, request.limits).then((result) =>
      process.send?.(result),
    );
  });
}
