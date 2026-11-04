// Checks a chosen file before upload, so a wrong type or size fails fast with a clear message. The
// server checks again (POST /api/documents: 413, 400 UNSUPPORTED_TYPE, 422 UNREADABLE_FILE).
import { LIMITS } from "@/lib/schemas";

export const ACCEPTED_EXTENSIONS = [".txt", ".md", ".pdf"] as const;

/** For the file input's `accept`. */
export const ACCEPT = ACCEPTED_EXTENSIONS.join(",");

/** The server caps the whole request; this leaves room for the title and the multipart framing. */
export const MAX_FILE_BYTES = LIMITS.uploadBytes - 64 * 1024;

const MAX_FILE_MB = (MAX_FILE_BYTES / (1024 * 1024)).toFixed(1);

/** What's wrong with the file, or undefined when it can be sent. */
export function fileError(file: File): string | undefined {
  const name = file.name.toLowerCase();
  if (!ACCEPTED_EXTENSIONS.some((extension) => name.endsWith(extension)))
    return "Upload a .txt, .md or text-based .pdf file.";
  if (file.size === 0) return "This file is empty.";
  if (file.size > MAX_FILE_BYTES)
    return `This file is too large. The limit is ${MAX_FILE_MB} MB.`;
  return undefined;
}

/** A starting title from the file name: no extension, at most the title limit. */
export function titleFromFile(file: File): string {
  const base = file.name.replace(/\.[^.]*$/, "").trim();
  return [...base].slice(0, LIMITS.documentTitle).join("");
}
