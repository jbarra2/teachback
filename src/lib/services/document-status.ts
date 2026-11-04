// What a document's status reads as to the user (PLAN §4, TESTING §6 "never stuck"). Shared by the
// course view (T13) and GET /api/documents/{id} (T12), so both report the same thing. Pure: no I/O.
import type { components } from "@/lib/api-client/schema";

type DocumentStatus = components["schemas"]["DocumentStatus"];

/** Still QUEUED or PROCESSING this long after upload means processing died: report FAILED. */
export const STUCK_AFTER_MS = 10 * 60 * 1000;

export const TIMED_OUT_MESSAGE = "Processing timed out, please upload again.";

/** For a FAILED row with no stored message: the contract shows an error with every FAILED. */
export const FAILED_FALLBACK_MESSAGE =
  "We couldn't process this document. Please upload it again.";

export interface StoredDocumentStatus {
  status: DocumentStatus;
  error: string | null;
  createdAt: Date;
}

export interface VisibleStatus {
  status: DocumentStatus;
  /** Present only with FAILED. Safe to show: stored errors are written for users (T12). */
  error?: string;
}

export function visibleStatus(
  document: StoredDocumentStatus,
  now: Date = new Date(),
): VisibleStatus {
  const { status, error, createdAt } = document;
  if (status === "FAILED")
    return { status, error: error?.trim() || FAILED_FALLBACK_MESSAGE };
  const pending = status === "QUEUED" || status === "PROCESSING";
  if (pending && now.getTime() - createdAt.getTime() >= STUCK_AFTER_MS)
    return { status: "FAILED", error: TIMED_OUT_MESSAGE };
  return { status };
}
