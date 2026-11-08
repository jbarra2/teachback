"use client";
// Practice weakest (T26): next-concept → question → feedback → next-concept, until the user stops.
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  EmptyState,
  ErrorState,
  MasteryBadge,
  Spinner,
  textLink,
} from "@/components/ui";
import {
  ApiError,
  api,
  isAbortError,
  unwrap,
  type ApiClient,
  type NextConcept,
} from "@/lib/api-client";
import { ID_PATTERN } from "@/lib/schemas";
import { errorMessage } from "./error-message";
import { PracticeSession } from "./practice-session";

type ConceptState =
  | { status: "loading" }
  | { status: "ready"; concept: NextConcept }
  | { status: "empty" }
  | { status: "not-found" }
  | { status: "error"; message: string };

interface WeakestPracticeProps {
  courseId: string;
  /** Tests pass a client with mocks or a failing network. */
  client?: ApiClient;
}

export function WeakestPractice({
  courseId,
  client = api,
}: WeakestPracticeProps) {
  const validId = ID_PATTERN.test(courseId);
  // A bad id never reaches the server: it reads as "not found" straight away.
  const [conceptState, setConceptState] = useState<ConceptState>(
    validId ? { status: "loading" } : { status: "not-found" },
  );
  // Bumped by "Next concept" and "Try again" to ask for the next concept.
  const [round, setRound] = useState(0);

  useEffect(() => {
    if (!validId) return;
    const controller = new AbortController();
    unwrap(
      client.GET("/api/courses/{id}/next-concept", {
        params: { path: { id: courseId } },
        signal: controller.signal,
      }),
    ).then(
      (concept) =>
        setConceptState(
          concept ? { status: "ready", concept } : { status: "empty" },
        ),
      (error: unknown) => {
        if (controller.signal.aborted || isAbortError(error)) return;
        const missing =
          error instanceof ApiError &&
          (error.code === "NOT_FOUND" || error.code === "VALIDATION_ERROR");
        setConceptState(
          missing
            ? { status: "not-found" }
            : { status: "error", message: errorMessage(error) },
        );
      },
    );
    return () => controller.abort();
  }, [client, courseId, validId, round]);

  function nextConcept() {
    // A second click before the spinner replaces the button asks only once.
    if (conceptState.status === "loading") return;
    setConceptState({ status: "loading" });
    setRound((n) => n + 1);
  }

  const courseHref = `/courses/${encodeURIComponent(courseId)}`;

  if (conceptState.status === "loading")
    return (
      <Spinner label="Finding your weakest concept…" className="self-center" />
    );

  if (conceptState.status === "not-found")
    return (
      <EmptyState
        title="Course not found"
        description="This course doesn't exist or isn't yours."
        action={
          <Link href="/courses" className={textLink}>
            Back to your courses
          </Link>
        }
      />
    );

  if (conceptState.status === "empty")
    return (
      <EmptyState
        title="Nothing to practise yet"
        description="Upload notes to this course first. Once they're processed, we'll pick what to practise."
        action={
          <Link href={courseHref} className={textLink}>
            Go to the course
          </Link>
        }
      />
    );

  if (conceptState.status === "error")
    return (
      <ErrorState
        title="Couldn't pick a concept"
        message={conceptState.message}
        onRetry={nextConcept}
      />
    );

  const { concept } = conceptState;
  return (
    <div className="flex flex-col gap-4">
      <p className="flex flex-wrap items-center gap-2 text-sm">
        <span>
          Your weakest concept:{" "}
          <span className="font-semibold">{concept.name}</span>
        </span>
        <MasteryBadge state={concept.state} />
      </p>
      {/* Keyed by round too, so the same concept twice still starts a fresh session. */}
      <PracticeSession
        key={`${concept.conceptId}-${round}`}
        courseId={courseId}
        conceptId={concept.conceptId}
        client={client}
        onNext={nextConcept}
      />
    </div>
  );
}
