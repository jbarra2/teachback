import { describe, expect, it } from "vitest";
import {
  RESULT_VALUE,
  UNSEEN,
  applyResult,
  masteryState,
  type Confidence,
  type Mastery,
  type Verdict,
} from "./score";

const NOW = new Date("2026-11-02T10:00:00.000Z");

function answer(
  mastery: Mastery,
  verdict: Verdict,
  confidence: Confidence = "HIGH",
): Mastery {
  return applyResult(mastery, { verdict, confidence }, NOW);
}

/** The scores after each answer in turn, starting unseen. */
function scores(verdicts: Verdict[]): number[] {
  let mastery = UNSEEN;
  return verdicts.map((verdict) => (mastery = answer(mastery, verdict)).score);
}

describe("RESULT_VALUE", () => {
  it("maps each verdict to its result", () => {
    expect(RESULT_VALUE).toEqual({ CORRECT: 1, PARTIAL: 0.5, INCORRECT: 0 });
  });
});

describe("applyResult", () => {
  it("moves the score halfway to the result and counts the attempt", () => {
    expect(
      // 0.25 + 0.5 × (1 − 0.25): exact in binary floating point, unlike 0.2.
      answer({ score: 0.25, attempts: 3, lastSeenAt: null }, "CORRECT"),
    ).toEqual({
      score: 0.625,
      attempts: 4,
      lastSeenAt: NOW,
    });
  });

  it("doesn't change the mastery it was given", () => {
    const before = { score: 0.5, attempts: 1, lastSeenAt: null };
    const copy = { ...before };
    answer(before, "INCORRECT");
    expect(before).toEqual(copy);
  });

  it("worked example: two correct answers from 0 give 0.5, then 0.75 (MASTERED)", () => {
    const first = answer(UNSEEN, "CORRECT");
    expect(first.score).toBe(0.5);
    expect(masteryState(first)).toBe("REVIEW");
    const second = answer(first, "CORRECT");
    expect(second.score).toBe(0.75);
    expect(masteryState(second)).toBe("MASTERED");
  });

  it("worked example: always partial goes 0.25, 0.375, 0.4375 and never reaches MASTERED", () => {
    let mastery = UNSEEN;
    const states = [];
    for (let i = 0; i < 25; i++) {
      mastery = answer(mastery, "PARTIAL");
      states.push(masteryState(mastery));
      expect(mastery.score).toBeLessThan(0.5);
    }
    expect(scores(["PARTIAL", "PARTIAL", "PARTIAL"])).toEqual([
      0.25, 0.375, 0.4375,
    ]);
    expect(states.slice(0, 3)).toEqual(["PRACTICE", "PRACTICE", "REVIEW"]);
    expect(states).not.toContain("MASTERED");
    expect(mastery.score).toBeCloseTo(0.5, 6);
  });

  it("worked example: a wrong answer at 0.75 drops to 0.375 (PRACTICE)", () => {
    const after = answer(
      { score: 0.75, attempts: 2, lastSeenAt: null },
      "INCORRECT",
    );
    expect(after.score).toBe(0.375);
    expect(masteryState(after)).toBe("PRACTICE");
  });

  it("LOW confidence changes nothing: score, attempts and last seen stay", () => {
    const before = {
      score: 0.5,
      attempts: 1,
      lastSeenAt: new Date("2026-11-01"),
    };
    for (const verdict of ["CORRECT", "PARTIAL", "INCORRECT"] as const) {
      expect(answer(before, verdict, "LOW")).toEqual(before);
    }
  });

  it("LOW confidence can't count toward the two attempts MASTERED needs", () => {
    const once = answer(UNSEEN, "CORRECT");
    const lowCorrect = answer(answer(once, "CORRECT", "LOW"), "CORRECT", "LOW");
    expect(lowCorrect.attempts).toBe(1);
    expect(masteryState(lowCorrect)).not.toBe("MASTERED");
  });

  it.each(["MEDIUM", "HIGH"] as const)(
    "%s confidence updates mastery",
    (confidence) => {
      expect(answer(UNSEEN, "CORRECT", confidence)).toMatchObject({
        score: 0.5,
        attempts: 1,
        lastSeenAt: NOW,
      });
    },
  );

  it("keeps the score between 0 and 1", () => {
    let mastery = UNSEEN;
    for (const verdict of [
      "CORRECT",
      "CORRECT",
      "CORRECT",
      "INCORRECT",
    ] as const) {
      mastery = answer(mastery, verdict);
      expect(mastery.score).toBeGreaterThanOrEqual(0);
      expect(mastery.score).toBeLessThanOrEqual(1);
    }
  });
});

describe("masteryState", () => {
  it.each([
    // unseen
    [0, 0, "PRACTICE"],
    [0.9, 0, "PRACTICE"],
    // REVIEW boundary at 0.4
    [0.3999, 1, "PRACTICE"],
    [0.4, 1, "REVIEW"],
    [0.4, 5, "REVIEW"],
    // MASTERED boundary at 0.75, and needs 2 attempts
    [0.7499, 2, "REVIEW"],
    [0.75, 1, "REVIEW"],
    [0.75, 2, "MASTERED"],
    [1, 10, "MASTERED"],
  ] as const)("score %d after %i attempts is %s", (score, attempts, state) => {
    expect(masteryState({ score, attempts })).toBe(state);
  });
});
