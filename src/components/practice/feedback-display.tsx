// The graded answer (T23): verdict, what's right and missing, the quotes it rests on, and how
// much to trust it. Model output is rendered as plain text only (PLAN §8).
import { Badge, Card, MasteryBadge, type BadgeTone } from "@/components/ui";
import type { AnswerResult, Feedback } from "@/lib/api-client";

const VERDICT: Record<Feedback["verdict"], { label: string; tone: BadgeTone }> =
  {
    CORRECT: { label: "Correct", tone: "success" },
    PARTIAL: { label: "Partly correct", tone: "warning" },
    INCORRECT: { label: "Not quite", tone: "danger" },
  };

const CONFIDENCE: Record<
  Feedback["confidence"],
  { label: string; tone: BadgeTone }
> = {
  HIGH: { label: "Confidence: High", tone: "success" },
  MEDIUM: { label: "Confidence: Medium", tone: "warning" },
  LOW: { label: "Confidence: Low", tone: "danger" },
};

/** Which warnings to show. "Unverified" covers both a failed evidence check and a LOW grade. */
export function feedbackNotices(
  feedback: Pick<Feedback, "unsupported" | "confidence" | "outsideNotes">,
) {
  return {
    unverified: feedback.unsupported || feedback.confidence === "LOW",
    outsideNotes: feedback.outsideNotes,
  };
}

function Notice({
  tone,
  title,
  children,
}: {
  tone: "warning" | "neutral";
  title: string;
  children: string;
}) {
  return (
    <div
      role="note"
      aria-label={title}
      className={
        tone === "warning"
          ? "rounded-md border border-warning bg-surface p-3 text-sm"
          : "rounded-md border border-border bg-surface p-3 text-sm"
      }
    >
      <p className="font-semibold">{title}</p>
      <p>{children}</p>
    </div>
  );
}

export function FeedbackDisplay({ result }: { result: AnswerResult }) {
  const { feedback, mastery } = result;
  const verdict = VERDICT[feedback.verdict];
  const confidence = CONFIDENCE[feedback.confidence];
  const notices = feedbackNotices(feedback);
  return (
    <Card role="region" aria-label="Feedback" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={verdict.tone}>{verdict.label}</Badge>
        <Badge tone={confidence.tone}>{confidence.label}</Badge>
        <MasteryBadge state={mastery.state} />
      </div>
      {notices.unverified && (
        <Notice tone="warning" title="Couldn't verify this against your notes">
          Treat this grade with caution and check it against your notes
          yourself.
        </Notice>
      )}
      {notices.outsideNotes && (
        <Notice tone="neutral" title="Goes beyond your notes">
          Parts of your answer use material your notes don&apos;t cover, so they
          weren&apos;t graded against them.
        </Notice>
      )}
      <div>
        <h3 className="text-sm font-semibold">What you got right</h3>
        <p className="text-sm">{feedback.whatCorrect}</p>
      </div>
      <div>
        <h3 className="text-sm font-semibold">What&apos;s missing</h3>
        <p className="text-sm">{feedback.whatMissing}</p>
      </div>
      {feedback.evidence.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold">From your notes</h3>
          <ul
            aria-label="Quotes from your notes"
            className="flex flex-col gap-2"
          >
            {feedback.evidence.map((item, i) => (
              <li key={`${item.chunkId}-${i}`}>
                <figure className="border-l-2 border-border pl-3">
                  <blockquote className="text-sm italic">
                    {item.quote}
                  </blockquote>
                  <figcaption className="text-xs text-muted">
                    {item.refLabel}
                  </figcaption>
                </figure>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
