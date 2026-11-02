// The one error type that leaves src/lib/ingest. Routes map `code` to the HTTP status in
// `status` (PLAN §7). Messages are fixed per reason and shown to the user, so they name the limit
// that was hit but never the filename, the note text or what the PDF parser said.

export const INGEST_ERROR_STATUS = {
  UNSUPPORTED_TYPE: 400,
  PAYLOAD_TOO_LARGE: 413,
  UNREADABLE_FILE: 422,
} as const;
export type IngestErrorCode = keyof typeof INGEST_ERROR_STATUS;

export interface IngestLimits {
  maxUploadMb: number;
  maxNoteChars: number;
  maxPdfPages: number;
}

const REASONS = {
  UNSUPPORTED_EXTENSION: {
    code: "UNSUPPORTED_TYPE",
    message: () => "Upload a .pdf, .txt or .md file.",
  },
  CONTENT_MISMATCH: {
    code: "UNSUPPORTED_TYPE",
    message: () =>
      "This file's contents don't match its extension. Upload a real .pdf, .txt or .md file.",
  },
  INVALID_TEXT_ENCODING: {
    code: "UNSUPPORTED_TYPE",
    message: () =>
      "This text file isn't valid UTF-8. Save it as UTF-8 and upload it again.",
  },
  FILE_TOO_LARGE: {
    code: "PAYLOAD_TOO_LARGE",
    message: (l: IngestLimits) =>
      `This file is larger than the ${l.maxUploadMb} MB upload limit.`,
  },
  TOO_MANY_PAGES: {
    code: "PAYLOAD_TOO_LARGE",
    message: (l: IngestLimits) =>
      `PDFs can have at most ${l.maxPdfPages} pages. Split this file into smaller parts and upload each one.`,
  },
  TEXT_TOO_LONG: {
    code: "PAYLOAD_TOO_LARGE",
    message: (l: IngestLimits) =>
      `These notes are longer than the ${l.maxNoteChars.toLocaleString("en-US")}-character limit. Split them into smaller parts.`,
  },
  NO_TEXT: {
    code: "UNREADABLE_FILE",
    message: () =>
      "We couldn't find any text to read. Scanned PDFs (images of pages) aren't supported yet.",
  },
  UNREADABLE_PDF: {
    code: "UNREADABLE_FILE",
    message: () =>
      "We couldn't read this PDF. It may be damaged or protected. Try exporting it again.",
  },
} as const satisfies Record<
  string,
  { code: IngestErrorCode; message: (limits: IngestLimits) => string }
>;
export type IngestErrorReason = keyof typeof REASONS;

export class IngestError extends Error {
  readonly code: IngestErrorCode;
  readonly status: (typeof INGEST_ERROR_STATUS)[IngestErrorCode];
  readonly reason: IngestErrorReason;

  constructor(reason: IngestErrorReason, limits: IngestLimits) {
    const { code, message } = REASONS[reason];
    super(message(limits));
    this.name = "IngestError";
    this.code = code;
    this.status = INGEST_ERROR_STATUS[code];
    this.reason = reason;
  }
}
