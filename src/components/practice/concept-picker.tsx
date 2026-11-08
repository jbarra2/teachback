"use client";
// Shown on /courses/[courseId]/practice when no ?concept= is given.
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  Card,
  EmptyState,
  ErrorState,
  MasteryBadge,
  Spinner,
  textLink,
  cn,
} from "@/components/ui";
import {
  api,
  isAbortError,
  unwrap,
  type ApiClient,
  type CourseConcept,
} from "@/lib/api-client";
import { errorMessage } from "./error-message";

type PickerState =
  | { status: "loading" }
  | { status: "ready"; concepts: CourseConcept[] }
  | { status: "error"; message: string };

interface ConceptPickerProps {
  courseId: string;
  client?: ApiClient;
}

export function ConceptPicker({ courseId, client = api }: ConceptPickerProps) {
  const [state, setState] = useState<PickerState>({ status: "loading" });
  // Bumped by "Try again".
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    unwrap(
      client.GET("/api/courses/{id}/concepts", {
        params: { path: { id: courseId } },
        signal: controller.signal,
      }),
    ).then(
      (concepts) => setState({ status: "ready", concepts }),
      (error: unknown) => {
        if (controller.signal.aborted || isAbortError(error)) return;
        setState({ status: "error", message: errorMessage(error) });
      },
    );
    return () => controller.abort();
  }, [client, courseId, attempt]);

  function retry() {
    setState({ status: "loading" });
    setAttempt((n) => n + 1);
  }

  if (state.status === "loading")
    return <Spinner label="Loading concepts…" className="self-center" />;

  if (state.status === "error")
    return (
      <ErrorState
        title="Couldn't load concepts"
        message={state.message}
        onRetry={retry}
      />
    );

  const courseHref = `/courses/${encodeURIComponent(courseId)}`;
  if (state.concepts.length === 0)
    return (
      <EmptyState
        title="No concepts yet"
        description="Upload notes for this course first. Their concepts will show up here to practice."
        action={
          <Link href={courseHref} className={textLink}>
            Go to the course
          </Link>
        }
      />
    );

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">Choose a concept</h2>
      <ul className="flex flex-col gap-3">
        {state.concepts.map((concept) => (
          <li key={concept.id}>
            <Card className="flex items-start justify-between gap-4">
              <div className="flex flex-col gap-1">
                <Link
                  href={`${courseHref}/practice?concept=${encodeURIComponent(concept.id)}`}
                  className={cn("font-medium", textLink)}
                >
                  {concept.name}
                </Link>
                <p className="text-sm text-muted">{concept.summary}</p>
              </div>
              <MasteryBadge state={concept.state} />
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
