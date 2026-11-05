import { type ChildProcess, fork } from "node:child_process";
import path from "node:path";

import { z } from "zod";

import { IngestError, type IngestLimits } from "./errors";
import {
  characterCount,
  normalizeText,
  PDF_CHILD_FLAG,
  type PdfRequest,
  type PdfResult,
} from "./pdf-child";

// Turns an upload into clean note text, or throws IngestError (PLAN §4 upload flow, TESTING §8
// "Malicious uploads"). Order matters: the size is checked before any parsing, the extension and
// the content must agree, and PDFs are parsed in a child process capped by page count, time,
// memory, and how many run at once.

export const MAX_PDF_PAGES = 100;
export const PDF_TIMEOUT_MS = 15_000;
/** V8 heap cap for the PDF child process. */
export const PDF_CHILD_HEAP_MB = 256;
/** Resident-memory cap for the whole child, including PDF.js buffers outside the V8 heap. */
export const PDF_MEMORY_BUDGET_MB = 512;
/** PDF parses at once per server instance, waiting requests, and how long one may wait. */
export const MAX_ACTIVE_PDF_PARSES = 2;
export const MAX_QUEUED_PDF_PARSES = 4;
export const PDF_QUEUE_WAIT_MS = 30_000;
/**
 * Run by Node directly, so it must ship as a file: next.config.ts traces it (with unpdf) into
 * the server build. Resolved from the working directory, which is the app root in dev, tests and
 * production.
 */
export const PDF_CHILD_ENTRY = "src/lib/ingest/pdf-child.ts";

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"
type FileKind = "pdf" | "text";
const KINDS: Record<string, FileKind> = { pdf: "pdf", txt: "text", md: "text" };

function positiveInt(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!/^\d+$/.test(raw) || value < 1)
    throw new Error(`${name} must be a positive integer`);
  return value;
}

/** Limits from the environment (PLAN §7), read per call so tests can change them. */
export function ingestLimits(): IngestLimits {
  return {
    maxUploadMb: positiveInt("MAX_UPLOAD_MB", 4),
    maxNoteChars: positiveInt("MAX_NOTE_CHARS", 200_000),
    maxPdfPages: MAX_PDF_PAGES,
  };
}

/**
 * Normalizes note text (NFC, LF line endings, unpaired surrogates and control characters
 * replaced or stripped, trimmed) and enforces the note limit in characters, as `text()` in
 * src/lib/schemas counts them. Also used for notes pasted as text instead of uploaded as a file.
 */
export function normalizeNoteText(
  text: string,
  limits: IngestLimits = ingestLimits(),
): string {
  const clean = normalizeText(text).trim();
  if (clean === "") throw new IngestError("NO_TEXT", limits);
  // Every character is at least one UTF-16 unit, so only a longer string needs counting.
  if (
    clean.length > limits.maxNoteChars &&
    characterCount(clean) > limits.maxNoteChars
  )
    throw new IngestError("TEXT_TOO_LONG", limits);
  return clean;
}

function kindOf(filename: string): FileKind | undefined {
  const dot = filename.lastIndexOf(".");
  if (dot < 0) return undefined;
  return KINDS[filename.slice(dot + 1).toLowerCase()];
}

function startsWith(data: Uint8Array, prefix: number[]): boolean {
  return prefix.every((byte, i) => data[i] === byte);
}

function decodeText(data: Uint8Array, limits: IngestLimits): string {
  // Windows Notepad's "Unicode" is UTF-16 with a byte order mark: real text, wrong encoding.
  if (startsWith(data, [0xff, 0xfe]) || startsWith(data, [0xfe, 0xff]))
    throw new IngestError("INVALID_TEXT_ENCODING", limits);
  // A NUL byte never appears in real notes, but does in nearly every binary format.
  if (data.includes(0) || startsWith(data, PDF_MAGIC))
    throw new IngestError("CONTENT_MISMATCH", limits);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(data);
  } catch {
    throw new IngestError("INVALID_TEXT_ENCODING", limits);
  }
}

// Per-instance limit on concurrent PDF parses: each child can use up to the memory budget, and
// per-user rate limits don't bound how many users upload at once.
let activeParses = 0;
const waiting: (() => void)[] = [];

async function acquireParseSlot(limits: IngestLimits): Promise<void> {
  if (activeParses < MAX_ACTIVE_PDF_PARSES) {
    activeParses++;
    return;
  }
  if (waiting.length >= MAX_QUEUED_PDF_PARSES)
    throw new IngestError("PDF_BUSY", limits);
  await new Promise<void>((resolve, reject) => {
    const take = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      waiting.splice(waiting.indexOf(take), 1);
      reject(new IngestError("PDF_BUSY", limits));
    }, PDF_QUEUE_WAIT_MS);
    waiting.push(take);
  });
}

/** Hands the slot straight to the next waiter, or frees it. */
function releaseParseSlot() {
  const next = waiting.shift();
  if (next) next();
  else activeParses--;
}

// Only variables the child needs: a hostile PDF runs in it, so it never sees the app's secrets.
function childEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { NODE_ENV: process.env.NODE_ENV };
  // Windows needs it to start a process; it holds no secrets.
  if (process.env.SYSTEMROOT) env.SYSTEMROOT = process.env.SYSTEMROOT;
  return env;
}

export interface PdfParseOptions {
  timeoutMs: number;
  memoryBudgetMb: number;
}

/** Parses in a child process and kills it at the time cap. Any exit without an answer is a 422. */
async function parseInChild(
  data: Uint8Array,
  limits: IngestLimits,
  { timeoutMs, memoryBudgetMb }: PdfParseOptions,
): Promise<string> {
  // A child that can't be started is the server running short (of memory, processes or file
  // descriptors), not a bad PDF: a 429 to retry.
  let child: ChildProcess;
  try {
    child = fork(
      // Not a module to bundle: Node runs the file as it is on disk (traced in next.config.ts).
      /* turbopackIgnore: true */ path.join(process.cwd(), PDF_CHILD_ENTRY),
      [PDF_CHILD_FLAG],
      {
        execArgv: [`--max-old-space-size=${PDF_CHILD_HEAP_MB}`],
        env: childEnv(),
        serialization: "advanced",
        stdio: ["ignore", "ignore", "ignore", "ipc"],
      },
    );
  } catch {
    throw new IngestError("PDF_BUSY", limits);
  }
  if (child.pid === undefined) {
    // It emits "error" next and may never "close", so nothing below may wait for it.
    child.once("error", () => undefined);
    throw new IngestError("PDF_BUSY", limits);
  }
  // "close", not "exit": Node can report the exit before it has read the answer from the IPC
  // channel, while "close" waits until the channel is drained.
  const closed = new Promise<void>((resolve) =>
    child.once("close", () => resolve()),
  );
  // The child's answer is checked like any untrusted input: it ran PDF.js on a hostile file.
  const answer = z.union([
    z.object({ text: z.string().max(2 * limits.maxNoteChars) }).strict(),
    z
      .object({
        reason: z.enum(["TOO_MANY_PAGES", "TEXT_TOO_LONG", "UNREADABLE_PDF"]),
      })
      .strict(),
  ]);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result: PdfResult = await new Promise((resolve, reject) => {
      // The time cap, a crash, V8 running out of memory, or the memory watchdog: all a 422.
      const fail = () => reject(new IngestError("UNREADABLE_PDF", limits));
      timer = setTimeout(fail, timeoutMs);
      child.once("message", (message) => {
        const parsed = answer.safeParse(message);
        if (parsed.success) resolve(parsed.data);
        else fail();
      });
      child.once("error", fail);
      child.once("close", fail);
      const request: PdfRequest = {
        data,
        limits: {
          maxPdfPages: limits.maxPdfPages,
          maxNoteChars: limits.maxNoteChars,
        },
        memoryBudgetBytes: memoryBudgetMb * 1024 * 1024,
        // The same cap, enforced again inside the child in case this process dies first.
        deadlineMs: timeoutMs,
      };
      child.send(request, (error) => {
        if (error) fail();
      });
    });
    if ("reason" in result) throw new IngestError(result.reason, limits);
    return result.text;
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGKILL");
    await closed;
  }
}

/**
 * Parses a PDF in a child process, at most MAX_ACTIVE_PDF_PARSES at once. The time cap starts
 * once a slot is free. Exported for tests, which pass shorter caps.
 */
export async function readPdf(
  data: Uint8Array,
  limits: IngestLimits,
  options: Partial<PdfParseOptions> = {},
): Promise<string> {
  await acquireParseSlot(limits);
  try {
    return await parseInChild(data, limits, {
      timeoutMs: options.timeoutMs ?? PDF_TIMEOUT_MS,
      memoryBudgetMb: options.memoryBudgetMb ?? PDF_MEMORY_BUDGET_MB,
    });
  } finally {
    releaseParseSlot();
  }
}

/**
 * Extracts clean text from an uploaded .pdf, .txt or .md file.
 * Throws IngestError: UNSUPPORTED_TYPE (400), PAYLOAD_TOO_LARGE (413), UNREADABLE_FILE (422)
 * or RATE_LIMITED (429, with `retryAfterSeconds`) when too many PDFs are being parsed.
 */
export async function extractText(
  data: Uint8Array,
  filename: string,
): Promise<string> {
  const limits = ingestLimits();
  if (data.byteLength > limits.maxUploadMb * 1024 * 1024)
    throw new IngestError("FILE_TOO_LARGE", limits);

  const kind = kindOf(filename);
  if (!kind) throw new IngestError("UNSUPPORTED_EXTENSION", limits);

  if (kind === "text")
    return normalizeNoteText(decodeText(data, limits), limits);

  if (!startsWith(data, PDF_MAGIC))
    throw new IngestError("CONTENT_MISMATCH", limits);
  return normalizeNoteText(await readPdf(data, limits), limits);
}
