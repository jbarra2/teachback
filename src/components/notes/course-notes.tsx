"use client";
// /courses/[courseId] (T15): the course's notes with their status, an upload form, and the concepts
// found so far. Concepts load once a document is READY, and again each time another one is.
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { EmptyState, ErrorState, Spinner } from "@/components/ui";
import {
  ApiError,
  api,
  isAbortError,
  unwrap,
  type ApiClient,
  type CourseConcept,
  type CourseDetail,
  type DocumentState,
  type DocumentSummary,
} from "@/lib/api-client";
import { ConceptList } from "./concept-list";
import { DocumentList } from "./document-list";
import { errorMessage } from "./error-message";
import { UploadForm } from "./upload-form";

type CourseState =
  | { status: "loading" }
  | { status: "ready"; course: CourseDetail }
  | { status: "missing" }
  | { status: "error"; message: string };

type ConceptState =
  | { status: "loading" }
  | { status: "ready"; concepts: CourseConcept[] }
  | { status: "error"; message: string };

interface CourseNotesProps {
  courseId: string;
  /** Tests pass a client with mocks or a failing network. */
  client?: ApiClient;
}

export function CourseNotes({ courseId, client = api }: CourseNotesProps) {
  const [state, setState] = useState<CourseState>({ status: "loading" });
  // Bumped by "Try again".
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    unwrap(
      client.GET("/api/courses/{id}", {
        params: { path: { id: courseId } },
        signal: controller.signal,
      }),
    ).then(
      (course) => setState({ status: "ready", course }),
      (error: unknown) => {
        if (controller.signal.aborted || isAbortError(error)) return;
        // An unknown id and another student's course look the same: not found.
        if (
          error instanceof ApiError &&
          (error.code === "NOT_FOUND" || error.code === "VALIDATION_ERROR")
        )
          setState({ status: "missing" });
        else setState({ status: "error", message: errorMessage(error) });
      },
    );
    return () => controller.abort();
  }, [client, courseId, attempt]);

  function retry() {
    setState({ status: "loading" });
    setAttempt((n) => n + 1);
  }

  const updateDocuments = useCallback(
    (update: (documents: DocumentSummary[]) => DocumentSummary[]) =>
      setState((current) =>
        current.status === "ready"
          ? {
              status: "ready",
              course: {
                ...current.course,
                documents: update(current.course.documents),
              },
            }
          : current,
      ),
    [],
  );

  const onStatus = useCallback(
    ({ id, status, error }: DocumentState) =>
      updateDocuments((documents) =>
        documents.map((document) =>
          document.id === id ? { ...document, status, error } : document,
        ),
      ),
    [updateDocuments],
  );

  if (state.status === "loading")
    return <Spinner label="Loading the course…" className="self-center" />;

  if (state.status === "error")
    return (
      <ErrorState
        title="Couldn't load the course"
        message={state.message}
        onRetry={retry}
      />
    );

  if (state.status === "missing")
    return (
      <EmptyState
        title="Course not found"
        description="It may have been removed, or the link is wrong."
        action={
          <Link href="/courses" className="text-primary underline">
            Back to your courses
          </Link>
        }
      />
    );

  const { course } = state;
  const readyCount = course.documents.filter(
    (document) => document.status === "READY",
  ).length;

  return (
    <div className="flex flex-col gap-8">
      <h2 className="text-xl font-semibold">{course.name}</h2>
      <UploadForm
        courseId={course.id}
        client={client}
        onUploaded={(document) =>
          updateDocuments((documents) => [document, ...documents])
        }
      />
      <section aria-labelledby="notes-heading" className="flex flex-col gap-3">
        <h2 id="notes-heading" className="text-lg font-semibold">
          Notes
        </h2>
        <DocumentList
          documents={course.documents}
          client={client}
          onStatus={onStatus}
        />
      </section>
      <section
        aria-labelledby="concepts-heading"
        className="flex flex-col gap-3"
      >
        <h2 id="concepts-heading" className="text-lg font-semibold">
          Concepts
        </h2>
        {readyCount === 0 ? (
          <p className="text-sm text-muted">
            Concepts appear here once your notes are processed.
          </p>
        ) : (
          <Concepts
            courseId={course.id}
            client={client}
            readyCount={readyCount}
          />
        )}
      </section>
    </div>
  );
}

/** Loads the concepts; a new READY document (a higher `readyCount`) loads them again. */
function Concepts({
  courseId,
  client,
  readyCount,
}: {
  courseId: string;
  client: ApiClient;
  readyCount: number;
}) {
  const [state, setState] = useState<ConceptState>({ status: "loading" });
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
  }, [client, courseId, readyCount, attempt]);

  if (state.status === "error")
    return (
      <ErrorState
        title="Couldn't load the concepts"
        message={state.message}
        onRetry={() => {
          setState({ status: "loading" });
          setAttempt((n) => n + 1);
        }}
      />
    );
  if (state.status === "loading")
    return <Spinner label="Loading concepts…" className="self-start" />;
  return <ConceptList courseId={courseId} concepts={state.concepts} />;
}
