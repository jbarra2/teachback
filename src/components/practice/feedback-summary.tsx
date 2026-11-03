// A short version of the feedback, enough for the practice loop. T23 replaces it with the full
// display (evidence quotes, confidence, the "couldn't verify" banner).
import { Badge, Card, MasteryBadge, type BadgeTone } from "@/components/ui";
import type { AnswerResult, Feedback } from "@/lib/api-client";

const VERDICT: Record<Feedback["verdict"], { label: string; tone: BadgeTone }> =
  {
    CORRECT: { label: "Correct", tone: "success" },
    PARTIAL: { label: "Partly correct", tone: "warning" },
    INCORRECT: { label: "Not quite", tone: "danger" },
  };

export function FeedbackSummary({ result }: { result: AnswerResult }) {
  const { feedback, mastery } = result;
  const verdict = VERDICT[feedback.verdict];
  return (
    <Card role="region" aria-label="Feedback" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={verdict.tone}>{verdict.label}</Badge>
        <MasteryBadge state={mastery.state} />
      </div>
      <div>
        <h3 className="text-sm font-semibold">What you got right</h3>
        <p className="text-sm">{feedback.whatCorrect}</p>
      </div>
      <div>
        <h3 className="text-sm font-semibold">What&apos;s missing</h3>
        <p className="text-sm">{feedback.whatMissing}</p>
      </div>
    </Card>
  );
}
