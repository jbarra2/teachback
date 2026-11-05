import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { AnswerResult, Feedback } from "@/lib/api-client";
import { answerResults } from "@/lib/mocks/fixtures";
import { FeedbackDisplay, feedbackNotices } from "./feedback-display";

const [correct, partial, incorrect] = answerResults;

function withFeedback(changes: Partial<Feedback>): AnswerResult {
  return { ...partial, feedback: { ...partial.feedback, ...changes } };
}

function renderFeedback(result: AnswerResult) {
  render(<FeedbackDisplay result={result} />);
  return screen.getByRole("region", { name: "Feedback" });
}

const UNVERIFIED = "Couldn't verify this against your notes";
const OUTSIDE = "Goes beyond your notes";

describe("FeedbackDisplay", () => {
  it("shows the verdict, both explanations, the quotes, confidence and mastery", () => {
    const region = renderFeedback(correct);
    expect(region).toHaveTextContent("Correct");
    expect(region).toHaveTextContent("Confidence: High");
    expect(region).toHaveTextContent("Review");
    expect(region).toHaveTextContent(correct.feedback.whatCorrect);
    expect(region).toHaveTextContent(correct.feedback.whatMissing);

    const quotes = screen.getByRole("list", { name: "Quotes from your notes" });
    const [item] = within(quotes).getAllByRole("listitem");
    const [evidence] = correct.feedback.evidence;
    expect(item).toHaveTextContent(evidence.quote);
    expect(item).toHaveTextContent(evidence.refLabel);
  });

  it.each([
    ["HIGH", "Confidence: High"],
    ["MEDIUM", "Confidence: Medium"],
    ["LOW", "Confidence: Low"],
  ] as const)("labels %s confidence in words", (confidence, label) => {
    renderFeedback(withFeedback({ confidence }));
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it("hides the quotes section when no evidence survived", () => {
    renderFeedback(incorrect);
    expect(
      screen.queryByRole("list", { name: "Quotes from your notes" }),
    ).not.toBeInTheDocument();
  });

  it("shows both notes for unsupported feedback that goes beyond the notes", () => {
    renderFeedback(incorrect);
    expect(screen.getByRole("note", { name: UNVERIFIED })).toBeInTheDocument();
    expect(screen.getByRole("note", { name: OUTSIDE })).toBeInTheDocument();
  });

  it("shows no notes for verified, in-notes feedback", () => {
    renderFeedback(correct);
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });

  it("renders an XSS payload in every model-written field literally", () => {
    const payload = `<img src=x onerror="alert(1)"><script>alert(2)</script>`;
    const region = renderFeedback(
      withFeedback({
        whatCorrect: `right ${payload}`,
        whatMissing: `missing ${payload}`,
        evidence: [
          {
            chunkId: "cchunk0000000000000000001",
            refLabel: `label ${payload}`,
            quote: `quote ${payload}`,
          },
        ],
      }),
    );
    for (const text of ["right", "missing", "label", "quote"])
      expect(region).toHaveTextContent(`${text} ${payload}`);
    expect(region.querySelector("img, script")).toBeNull();
  });
});

describe("feedbackNotices", () => {
  it.each([
    // unsupported, confidence, outsideNotes → unverified, outside
    [true, "HIGH", false, true, false],
    [true, "MEDIUM", false, true, false],
    [true, "LOW", false, true, false],
    [false, "LOW", false, true, false],
    [false, "MEDIUM", false, false, false],
    [false, "HIGH", false, false, false],
    [false, "HIGH", true, false, true],
    [true, "LOW", true, true, true],
  ] as const)(
    "unsupported=%s confidence=%s outsideNotes=%s → unverified=%s outside=%s",
    (unsupported, confidence, outsideNotes, unverified, outside) => {
      expect(
        feedbackNotices({ unsupported, confidence, outsideNotes }),
      ).toEqual({ unverified, outsideNotes: outside });
    },
  );
});
