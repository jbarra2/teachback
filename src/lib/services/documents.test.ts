import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The deadline, here with the database and the AI faked; the pipeline runs against PostgreSQL in
// tests/integration/documents.int.test.ts.
const updateMany = vi.fn();
const findUniqueOrThrow = vi.fn();
vi.mock("@/lib/db", () => ({
  db: { document: { updateMany, findUniqueOrThrow } },
}));
const extractConcepts = vi.fn();
vi.mock("@/lib/ai/extract-concepts", () => ({ extractConcepts }));
vi.mock("@/lib/log", () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const { AI_FAILED_MESSAGE, EXTRACTION_DEADLINE_MS, processDocument } =
  await import("./documents");
const { STUCK_AFTER_MS } = await import("./document-status");

beforeEach(() => {
  updateMany.mockResolvedValue({ count: 1 });
  findUniqueOrThrow.mockResolvedValue({
    courseId: "ccourse000000000000000001",
    title: "Notes",
    rawText: "Cells are the basic unit of life.",
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("processDocument's AI deadline", () => {
  it("ends the AI step before a pending document would read as FAILED", () => {
    expect(EXTRACTION_DEADLINE_MS).toBeLessThan(STUCK_AFTER_MS);
  });

  it("marks the document FAILED when extraction hangs past the deadline", async () => {
    vi.useFakeTimers();
    extractConcepts.mockReturnValue(new Promise(() => {}));
    const run = processDocument("cdoc00000000000000000001");
    await vi.advanceTimersByTimeAsync(EXTRACTION_DEADLINE_MS - 1);
    expect(updateMany).toHaveBeenCalledTimes(1); // only the claim so far
    await vi.advanceTimersByTimeAsync(1);
    await run;
    expect(updateMany).toHaveBeenLastCalledWith({
      where: { id: "cdoc00000000000000000001", status: "PROCESSING" },
      data: { status: "FAILED", error: AI_FAILED_MESSAGE },
    });
  });
});
