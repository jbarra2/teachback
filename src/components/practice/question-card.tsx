import { Badge, Card } from "@/components/ui";
import type { Question } from "@/lib/api-client";

const KIND_LABEL: Record<Question["kind"], string> = {
  EXPLAIN: "Explain",
  WHY: "Why",
  COMPARE: "Compare",
  APPLY: "Apply",
};

export function QuestionCard({ question }: { question: Question }) {
  return (
    <Card className="flex flex-col gap-3">
      <Badge className="self-start">{KIND_LABEL[question.kind]}</Badge>
      <h2 className="text-lg font-semibold">{question.text}</h2>
      {question.sources.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
          <span>From your notes:</span>
          <ul aria-label="Sources" className="flex flex-wrap gap-2">
            {question.sources.map((source) => (
              <li key={source.chunkId}>
                <Badge>{source.refLabel}</Badge>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
