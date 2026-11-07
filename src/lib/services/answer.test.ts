import { afterEach, describe, expect, it, vi } from "vitest";

// The deadline's wiring, with the database and the AI faked; everything else runs against
// PostgreSQL in src/lib/services/answer.int.test.ts.
const transaction = vi.fn();
vi.mock("@/lib/db", () => ({
  db: {
    question: {
      findFirst: vi.fn().mockResolvedValue({
        id: "cquestion0000000000000001",
        text: "Why do cells divide?",
        conceptId: "cconcept00000000000000001",
        concept: {
          chunks: [
            {
              chunk: {
                id: "cchunk0000000000000000001",
                order: 0,
                text: "Cells divide to grow and to repair tissue.",
                refLabel: "Week 1",
                document: { createdAt: new Date(0) },
              },
            },
          ],
        },
      }),
    },
    $transaction: transaction,
  },
}));
const evaluateAnswer = vi.fn();
vi.mock("@/lib/ai/evaluate-answer", () => ({ evaluateAnswer }));

const { answerQuestion, ANSWER_DEADLINE_MS } = await import("./answer");

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("answerQuestion's AI deadline", () => {
  it("gives up with an AI timeout when grading hangs, and saves nothing", async () => {
    vi.useFakeTimers();
    evaluateAnswer.mockReturnValue(new Promise(() => {}));
    const result = answerQuestion(
      "cuser0000000000000000001",
      "cquestion0000000000000001",
      "To grow.",
    );
    const settled = expect(result).rejects.toMatchObject({
      name: "AiError",
      code: "TIMEOUT",
    });
    await vi.advanceTimersByTimeAsync(ANSWER_DEADLINE_MS);
    await settled;
    expect(transaction).not.toHaveBeenCalled();
  });

  it("allows one 60 s attempt and a quick retry, not two full timeouts", () => {
    expect(ANSWER_DEADLINE_MS).toBeGreaterThan(60_000);
    expect(ANSWER_DEADLINE_MS).toBeLessThan(120_000);
  });
});
