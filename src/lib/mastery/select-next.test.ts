import { describe, expect, it } from "vitest";
import { selectNextConcept, type ConceptProgress } from "./select-next";

function concept(
  id: string,
  score: number,
  attempts: number,
  lastSeenAt: string | null = null,
): ConceptProgress {
  return {
    id,
    score,
    attempts,
    lastSeenAt: lastSeenAt === null ? null : new Date(lastSeenAt),
  };
}

describe("selectNextConcept", () => {
  it("is null when there are no concepts", () => {
    expect(selectNextConcept([])).toBeNull();
    expect(selectNextConcept([], "a")).toBeNull();
  });

  it("puts PRACTICE before REVIEW before MASTERED, whatever the score", () => {
    const mastered = concept("mastered", 0.8, 3, "2026-10-01");
    const review = concept("review", 0.45, 1, "2026-10-01");
    const practice = concept("practice", 0.3, 1, "2026-11-01");
    expect(selectNextConcept([mastered, review, practice])).toBe("practice");
    expect(selectNextConcept([mastered, review])).toBe("review");
    expect(selectNextConcept([mastered])).toBe("mastered");
  });

  it("orders by state, not raw score: 0.75 after one attempt (REVIEW) beats 0.76 MASTERED", () => {
    expect(
      selectNextConcept([concept("m", 0.76, 2), concept("r", 0.75, 1)]),
    ).toBe("r");
  });

  it("within a state, picks the lowest score", () => {
    expect(
      selectNextConcept([
        concept("high", 0.35, 2, "2026-10-01"),
        concept("low", 0.1, 2, "2026-11-01"),
      ]),
    ).toBe("low");
  });

  it("on equal scores, picks an unseen concept first", () => {
    expect(
      selectNextConcept([
        concept("seen", 0, 1, "2026-10-01"),
        concept("unseen", 0, 0),
      ]),
    ).toBe("unseen");
  });

  it("on equal scores, picks the least recently seen", () => {
    expect(
      selectNextConcept([
        concept("recent", 0.5, 1, "2026-11-01T12:00:00Z"),
        concept("old", 0.5, 1, "2026-10-01T12:00:00Z"),
      ]),
    ).toBe("old");
  });

  it("breaks a full tie by id, so the pick doesn't depend on input order", () => {
    const a = concept("a", 0, 0);
    const b = concept("b", 0, 0);
    expect(selectNextConcept([a, b])).toBe("a");
    expect(selectNextConcept([b, a])).toBe("a");
  });

  it("skips the previous concept when there's another", () => {
    const weakest = concept("weakest", 0, 0);
    const other = concept("other", 0.9, 3, "2026-10-01");
    expect(selectNextConcept([weakest, other], "weakest")).toBe("other");
  });

  it("returns the previous concept when it's the only one", () => {
    expect(selectNextConcept([concept("only", 0.2, 1)], "only")).toBe("only");
  });

  it("ignores a previous id that isn't in the list", () => {
    expect(
      selectNextConcept(
        [concept("a", 0.1, 1), concept("b", 0.2, 1)],
        "missing",
      ),
    ).toBe("a");
  });

  it("treats a null or missing previous id as none", () => {
    const list = [concept("a", 0.1, 1), concept("b", 0.2, 1)];
    expect(selectNextConcept(list, null)).toBe("a");
    expect(selectNextConcept(list)).toBe("a");
  });

  it("doesn't reorder the list it was given", () => {
    const list = [concept("z", 0.9, 3), concept("a", 0, 0)];
    selectNextConcept(list);
    expect(list.map((c) => c.id)).toEqual(["z", "a"]);
  });
});
