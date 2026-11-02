import { getDocumentProxy } from "unpdf";

import { IngestError, type IngestLimits } from "./errors";

// Turns an upload into clean note text, or throws IngestError (PLAN §4 upload flow, TESTING §8
// "Malicious uploads"). Order matters: the size is checked before any parsing, the extension and
// the content must agree, and PDF parsing is capped by page count and wall-clock time.

export const MAX_PDF_PAGES = 100;
export const PDF_TIMEOUT_MS = 15_000;

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

// Control characters (\p{Cc}: C0, DEL, C1) except newline and tab.
const CONTROL_CHARS = /[^\P{Cc}\n\t]/gu;

function normalize(text: string): string {
  return text
    .replace(/^﻿/, "")
    .replace(/\r\n?/g, "\n")
    .normalize("NFC")
    .replace(CONTROL_CHARS, "");
}

/**
 * Normalizes note text (NFC, LF line endings, control characters stripped) and enforces the
 * note limits. Also used for notes pasted as text instead of uploaded as a file.
 */
export function normalizeNoteText(
  text: string,
  limits: IngestLimits = ingestLimits(),
): string {
  const clean = normalize(text);
  if (clean.trim() === "") throw new IngestError("NO_TEXT", limits);
  if (clean.length > limits.maxNoteChars)
    throw new IngestError("TEXT_TOO_LONG", limits);
  return clean;
}

function kindOf(filename: string): FileKind | undefined {
  const dot = filename.lastIndexOf(".");
  if (dot < 0) return undefined;
  return KINDS[filename.slice(dot + 1).toLowerCase()];
}

function startsWithPdfMagic(data: Uint8Array): boolean {
  return PDF_MAGIC.every((byte, i) => data[i] === byte);
}

function decodeText(data: Uint8Array, limits: IngestLimits): string {
  // A NUL byte never appears in real notes, but does in nearly every binary format.
  if (data.includes(0) || startsWithPdfMagic(data))
    throw new IngestError("CONTENT_MISMATCH", limits);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(data);
  } catch {
    throw new IngestError("INVALID_TEXT_ENCODING", limits);
  }
}

async function readPdf(
  data: Uint8Array,
  limits: IngestLimits,
): Promise<string> {
  let timedOut = false;
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const read = async (): Promise<string> => {
    // A copy, because PDF.js may take ownership of the buffer it is given.
    const doc = await getDocumentProxy(new Uint8Array(data), {
      verbosity: 0,
      stopAtErrors: true,
    });
    pdf = doc;
    if (timedOut) {
      await doc.loadingTask.destroy();
      return "";
    }
    if (doc.numPages > limits.maxPdfPages)
      throw new IngestError("TOO_MANY_PAGES", limits);

    const pages: string[] = [];
    let length = 0;
    for (let n = 1; n <= doc.numPages && !timedOut; n++) {
      const content = await (await doc.getPage(n)).getTextContent();
      const text = normalize(
        content.items
          .map((item) =>
            "str" in item ? item.str + (item.hasEOL ? "\n" : "") : "",
          )
          .join(""),
      );
      // Stop reading as soon as the limit is passed instead of extracting every page.
      length += text.length + 2;
      if (length > limits.maxNoteChars + 2)
        throw new IngestError("TEXT_TOO_LONG", limits);
      pages.push(text);
    }
    return pages.join("\n\n");
  };

  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      reject(new IngestError("UNREADABLE_PDF", limits));
    }, PDF_TIMEOUT_MS);
  });

  try {
    return await Promise.race([read(), timeout]);
  } catch (error) {
    // Parser errors are replaced, so their text (which can quote the file) never leaves here.
    if (error instanceof IngestError) throw error;
    throw new IngestError("UNREADABLE_PDF", limits);
  } finally {
    clearTimeout(timer);
    await pdf?.loadingTask.destroy();
  }
}

/**
 * Extracts clean text from an uploaded .pdf, .txt or .md file.
 * Throws IngestError: UNSUPPORTED_TYPE (400), PAYLOAD_TOO_LARGE (413) or UNREADABLE_FILE (422).
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

  if (!startsWithPdfMagic(data))
    throw new IngestError("CONTENT_MISMATCH", limits);
  return normalizeNoteText(await readPdf(data, limits), limits);
}
