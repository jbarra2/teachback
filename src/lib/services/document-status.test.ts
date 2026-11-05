import { describe, expect, it } from "vitest";
import {
  FAILED_FALLBACK_MESSAGE,
  STUCK_AFTER_MS,
  TIMED_OUT_MESSAGE,
  visibleStatus,
  type StoredDocumentStatus,
} from "./document-status";

const UPLOADED = new Date("2026-11-03T10:00:00.000Z");
const after = (ms: number) => new Date(UPLOADED.getTime() + ms);
const doc = (
  status: StoredDocumentStatus["status"],
  error: string | null = null,
): StoredDocumentStatus => ({ status, error, createdAt: UPLOADED });

describe("visibleStatus", () => {
  it("waits 10 minutes", () => {
    expect(STUCK_AFTER_MS).toBe(10 * 60 * 1000);
  });

  it.each(["QUEUED", "PROCESSING"] as const)(
    "shows %s as it is until 10 minutes after upload",
    (status) => {
      expect(visibleStatus(doc(status), after(STUCK_AFTER_MS - 1))).toEqual({
        status,
      });
    },
  );

  it.each(["QUEUED", "PROCESSING"] as const)(
    "shows %s as FAILED, with the timeout message, from 10 minutes after upload",
    (status) => {
      for (const elapsed of [STUCK_AFTER_MS, STUCK_AFTER_MS * 50])
        expect(visibleStatus(doc(status), after(elapsed))).toEqual({
          status: "FAILED",
          error: TIMED_OUT_MESSAGE,
        });
    },
  );

  it("never fails a READY document, however old", () => {
    expect(visibleStatus(doc("READY"), after(STUCK_AFTER_MS * 1000))).toEqual({
      status: "READY",
    });
  });

  it("shows a FAILED document's own error, trimmed", () => {
    expect(
      visibleStatus(
        doc("FAILED", "\n  We couldn't read any text in that file. \n"),
      ),
    ).toEqual({
      status: "FAILED",
      error: "We couldn't read any text in that file.",
    });
  });

  it.each([null, "", "   \n"])(
    "gives a FAILED document with no stored error (%j) a safe message, as the contract needs one",
    (error) => {
      expect(visibleStatus(doc("FAILED", error))).toEqual({
        status: "FAILED",
        error: FAILED_FALLBACK_MESSAGE,
      });
    },
  );

  it.each(["QUEUED", "PROCESSING", "READY"] as const)(
    "never shows a stored error on a %s document",
    (status) => {
      expect(visibleStatus(doc(status, "left over"), UPLOADED)).toEqual({
        status,
      });
    },
  );

  it("uses the current time by default", () => {
    const stale = { ...doc("QUEUED"), createdAt: new Date(0) };
    expect(visibleStatus(stale).status).toBe("FAILED");
    const fresh = { ...doc("QUEUED"), createdAt: new Date() };
    expect(visibleStatus(fresh).status).toBe("QUEUED");
  });
});
