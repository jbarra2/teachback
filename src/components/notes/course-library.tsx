"use client";
// /courses (T15): the student's courses, and a form to create one.
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  Button,
  Card,
  cn,
  EmptyState,
  ErrorState,
  focusRing,
  Input,
  Spinner,
} from "@/components/ui";
import {
  api,
  isAbortError,
  unwrap,
  type ApiClient,
  type Course,
} from "@/lib/api-client";
import { LIMITS } from "@/lib/schemas";
import { errorMessage, fieldMessage } from "./error-message";

type ListState =
  | { status: "loading" }
  | { status: "ready"; courses: Course[] }
  | { status: "error"; message: string };

interface CourseLibraryProps {
  /** Tests pass a client with mocks or a failing network. */
  client?: ApiClient;
}

export function CourseLibrary({ client = api }: CourseLibraryProps) {
  const [list, setList] = useState<ListState>({ status: "loading" });
  // Bumped by "Try again".
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    unwrap(client.GET("/api/courses", { signal: controller.signal })).then(
      (courses) => {
        if (!controller.signal.aborted) setList({ status: "ready", courses });
      },
      (error: unknown) => {
        if (controller.signal.aborted || isAbortError(error)) return;
        setList({ status: "error", message: errorMessage(error) });
      },
    );
    return () => controller.abort();
  }, [client, attempt]);

  function retry() {
    setList({ status: "loading" });
    setAttempt((n) => n + 1);
  }

  function added(course: Course) {
    setList((current) =>
      current.status === "ready"
        ? { status: "ready", courses: [...current.courses, course] }
        : current,
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <CreateCourseForm client={client} onCreated={added} />
      {list.status === "loading" && (
        <Spinner label="Loading your courses…" className="self-center" />
      )}
      {list.status === "error" && (
        <ErrorState
          title="Couldn't load your courses"
          message={list.message}
          onRetry={retry}
        />
      )}
      {list.status === "ready" && list.courses.length === 0 && (
        <EmptyState
          title="No courses yet"
          description="Create a course above, then upload your lecture notes to start practising."
        />
      )}
      {list.status === "ready" && list.courses.length > 0 && (
        <ul aria-label="Your courses" className="grid gap-3 sm:grid-cols-2">
          {list.courses.map((course) => (
            <li key={course.id}>
              <Link
                href={`/courses/${encodeURIComponent(course.id)}`}
                className={cn(
                  "block rounded-lg border border-border p-4 font-medium hover:bg-surface",
                  focusRing,
                )}
              >
                {course.name}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CreateCourseForm({
  client,
  onCreated,
}: {
  client: ApiClient;
  onCreated: (course: Course) => void;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  // State updates on the next render; this blocks a second submit right away.
  const busy = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Enter a course name.");
      inputRef.current?.focus();
      return;
    }
    busy.current = true;
    setPending(true);
    setError(undefined);
    try {
      const course = await unwrap(
        client.POST("/api/courses", { body: { name: trimmed } }),
      );
      setName("");
      onCreated(course);
    } catch (caught) {
      setError(fieldMessage(caught, "name"));
      inputRef.current?.focus();
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  return (
    <Card>
      <form
        noValidate
        method="post"
        aria-label="Create a course"
        onSubmit={(event) => void submit(event)}
        className="flex flex-col gap-3"
      >
        <Input
          ref={inputRef}
          id="course-name"
          name="name"
          label="New course"
          placeholder="e.g. BIOL 180 · Intro Biology"
          maxLength={LIMITS.courseName}
          showCount
          value={name}
          error={error}
          onChange={(event) => setName(event.target.value)}
        />
        <Button type="submit" loading={pending} className="self-start">
          Create course
        </Button>
      </form>
    </Card>
  );
}
