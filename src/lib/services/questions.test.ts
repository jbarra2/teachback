import { afterEach, describe, expect, it, vi } from "vitest";

// The deadline's wiring, with the database and the AI faked; everything else runs against
// PostgreSQL in tests/integration/questions.int.test.ts.
const create = vi.fn();
vi.mock("@/lib/db", () => ({
  db: {
    concept: {
      findFirst: vi.fn().mockResolvedValue({
        id: "cconcept00000000000000001",
        name: "Mitosis",
        summary: "How cells divide.",
        chunks: [
          {
            chunk: {
              id: "cchunk0000000000000000001",
              order: 0,
              text: "Cells divide.",
              refLabel: "Week 1",
              document: { createdAt: new Date(0) },
            },
          },
        ],
      }),
    },
    question: { findMany: vi.fn().mockResolvedValue([]), create },
  },
}));
const generateQuestion = vi.fn();
vi.mock("@/lib/ai/generate-question", () => ({ generateQuestion }));

const { createQuestion, inNoteOrder, QUESTION_DEADLINE_MS } =
  await import("./questions");

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("createQuestion's AI deadline", () => {
  it("gives up with an AI timeout when generation hangs, and saves nothing", async () => {
    vi.useFakeTimers();
    generateQuestion.mockReturnValue(new Promise(() => {}));
    const result = createQuestion(
      "cuser0000000000000000001",
      "cconcept00000000000000001",
    );
    const settled = expect(result).rejects.toMatchObject({
      name: "AiError",
      code: "TIMEOUT",
    });
    await vi.advanceTimersByTimeAsync(QUESTION_DEADLINE_MS);
    await settled;
    expect(create).not.toHaveBeenCalled();
  });

  it("allows one 60 s attempt and a quick retry, not two full timeouts", () => {
    expect(QUESTION_DEADLINE_MS).toBeGreaterThan(60_000);
    expect(QUESTION_DEADLINE_MS).toBeLessThan(120_000);
  });
});

describe("inNoteOrder", () => {
  const chunk = (id: string, order: number, day: number) => ({
    id,
    order,
    text: id,
    refLabel: id,
    document: { createdAt: new Date(Date.UTC(2026, 10, day)) },
  });

  it("puts the oldest document first, then each document's order, then the id", () => {
    const sorted = inNoteOrder([
      chunk("cb", 0, 2),
      chunk("cz", 1, 1),
      chunk("cy", 0, 1),
      chunk("cx", 0, 1),
    ]);
    expect(sorted.map((c) => c.id)).toEqual(["cx", "cy", "cz", "cb"]);
  });

  it("doesn't reorder the array it was given", () => {
    const given = [chunk("c2", 1, 1), chunk("c1", 0, 1)];
    inNoteOrder(given);
    expect(given.map((c) => c.id)).toEqual(["c2", "c1"]);
  });
});
