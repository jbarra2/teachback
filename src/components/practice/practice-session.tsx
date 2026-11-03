"use client";
// One concept's practice loop (T16): question → answer → feedback → next question.
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button, EmptyState, ErrorState, Spinner } from "@/components/ui";
import {
  ApiError,
  api,
  isAbortError,
  unwrap,
  type AnswerResult,
  type ApiClient,
  type Question,
} from "@/lib/api-client";
import { ID_PATTERN } from "@/lib/schemas";
import { AnswerForm } from "./answer-form";
import { errorMessage } from "./error-message";
import { FeedbackSummary } from "./feedback-summary";
import { QuestionCard } from "./question-card";

type QuestionState =
  | { status: "loading" }
  | { status: "ready"; question: Question }
  | { status: "not-found" }
  | { status: "error"; message: string };

interface PracticeSessionProps {
  courseId: string;
  conceptId: string;
  /** Tests pass a client with mocks or a failing network. */
  client?: ApiClient;
}

export function PracticeSession({
  courseId,
  conceptId,
  client = api,
}: PracticeSessionProps) {
  const validId = ID_PATTERN.test(conceptId);
  // A bad id never reaches the server: it reads as "not found" straight away.
  const [questionState, setQuestionState] = useState<QuestionState>(
    validId ? { status: "loading" } : { status: "not-found" },
  );
  // Bumped by "Next question" and "Try again" to fetch another question.
  const [round, setRound] = useState(0);
  const [answer, setAnswer] = useState("");
  const [pending, setPending] = useState(false);
  const [submitError, setSubmitError] = useState<string>();
  const [result, setResult] = useState<AnswerResult>();

  useEffect(() => {
    if (!validId) return;
    const controller = new AbortController();
    unwrap(
      client.POST("/api/concepts/{id}/question", {
        params: { path: { id: conceptId } },
        signal: controller.signal,
      }),
    ).then(
      (question) => setQuestionState({ status: "ready", question }),
      (error: unknown) => {
        if (controller.signal.aborted || isAbortError(error)) return;
        const missing =
          error instanceof ApiError &&
          (error.code === "NOT_FOUND" || error.code === "VALIDATION_ERROR");
        setQuestionState(
          missing
            ? { status: "not-found" }
            : { status: "error", message: errorMessage(error) },
        );
      },
    );
    return () => controller.abort();
  }, [client, conceptId, validId, round]);

  function newQuestion() {
    setQuestionState({ status: "loading" });
    setAnswer("");
    setResult(undefined);
    setSubmitError(undefined);
    setRound((n) => n + 1);
  }

  async function submitAnswer(text: string) {
    if (questionState.status !== "ready") return;
    setPending(true);
    setSubmitError(undefined);
    try {
      setResult(
        await unwrap(
          client.POST("/api/questions/{id}/answer", {
            params: { path: { id: questionState.question.questionId } },
            body: { answer: text },
          }),
        ),
      );
    } catch (error) {
      setSubmitError(errorMessage(error));
    } finally {
      setPending(false);
    }
  }

  const pickerHref = `/courses/${encodeURIComponent(courseId)}/practice`;

  if (questionState.status === "loading")
    return <Spinner label="Loading your question…" className="self-center" />;

  if (questionState.status === "not-found")
    return (
      <EmptyState
        title="Concept not found"
        description="This concept doesn't exist or isn't in this course."
        action={
          <Link href={pickerHref} className="text-primary underline">
            Choose a concept
          </Link>
        }
      />
    );

  if (questionState.status === "error")
    return (
      <ErrorState
        title="Couldn't load a question"
        message={questionState.message}
        onRetry={newQuestion}
      />
    );

  return (
    <div className="flex flex-col gap-6">
      <QuestionCard question={questionState.question} />
      <AnswerForm
        value={answer}
        onChange={setAnswer}
        onSubmit={submitAnswer}
        pending={pending}
        disabled={result !== undefined}
      />
      {/* No retry button here: Submit sends again, behind the form's double-submit guard. */}
      {submitError && (
        <ErrorState title="Couldn't send your answer" message={submitError} />
      )}
      {result && (
        <>
          <FeedbackSummary result={result} />
          <div className="flex flex-wrap gap-4">
            <Button onClick={newQuestion}>Next question</Button>
            <Link href={pickerHref} className="self-center text-sm underline">
              Choose another concept
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
