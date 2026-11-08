"use client";
// A course's uploaded notes and their processing status (T15). Each document that's still QUEUED or
// PROCESSING polls GET /api/documents/{id} every 2 s until READY or FAILED, waits longer after each
// failed poll, and stops when it leaves the page.
import { useEffect, useRef, useState } from "react";
import { Badge, Spinner, type BadgeTone } from "@/components/ui";
import {
  ApiError,
  isAbortError,
  unwrap,
  type ApiClient,
  type DocumentState,
  type DocumentStatus,
  type DocumentSummary,
} from "@/lib/api-client";

export const POLL_MS = 2000;
/** The longest wait between polls while they keep failing. */
export const MAX_POLL_MS = 30_000;

const STATUS: Record<DocumentStatus, { label: string; tone: BadgeTone }> = {
  QUEUED: { label: "Waiting", tone: "neutral" },
  PROCESSING: { label: "Processing", tone: "warning" },
  READY: { label: "Ready", tone: "success" },
  FAILED: { label: "Failed", tone: "danger" },
};

export const isDone = (status: DocumentStatus) =>
  status === "READY" || status === "FAILED";

interface DocumentListProps {
  documents: DocumentSummary[];
  client: ApiClient;
  /** A poll found a new status. */
  onStatus: (state: DocumentState) => void;
}

export function DocumentList({
  documents,
  client,
  onStatus,
}: DocumentListProps) {
  if (documents.length === 0)
    return <p className="text-sm text-muted">No notes uploaded yet.</p>;
  return (
    <ul aria-label="Your notes" className="flex flex-col gap-2">
      {documents.map((document) => (
        <DocumentRow
          key={document.id}
          document={document}
          client={client}
          onStatus={onStatus}
        />
      ))}
    </ul>
  );
}

function DocumentRow({
  document,
  client,
  onStatus,
}: {
  document: DocumentSummary;
  client: ApiClient;
  onStatus: (state: DocumentState) => void;
}) {
  const { id, status } = document;
  const done = isDone(status);
  // Polls keep failing: the list says it's still trying.
  const [retrying, setRetrying] = useState(false);
  // The server says it's gone (or never ours): polling has stopped for good.
  const [gone, setGone] = useState(false);
  // The latest callback, so a new one from the parent doesn't restart the polling.
  const report = useRef(onStatus);
  useEffect(() => {
    report.current = onStatus;
  });

  useEffect(() => {
    if (done) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let delay = POLL_MS;

    async function poll() {
      try {
        const state = await unwrap(
          client.GET("/api/documents/{id}", {
            params: { path: { id } },
            signal: controller.signal,
          }),
        );
        // Unmounted while the request was in flight, and it answered anyway.
        if (controller.signal.aborted) return;
        delay = POLL_MS;
        setRetrying(false);
        report.current(state);
        if (isDone(state.status)) return;
      } catch (error) {
        if (controller.signal.aborted || isAbortError(error)) return;
        // Gone (or never ours): polling again won't change that.
        if (error instanceof ApiError && error.code === "NOT_FOUND") {
          setRetrying(false);
          setGone(true);
          return;
        }
        delay = Math.min(delay * 2, MAX_POLL_MS);
        setRetrying(true);
      }
      timer = setTimeout(() => void poll(), delay);
    }

    timer = setTimeout(() => void poll(), POLL_MS);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [client, id, done]);

  const { label, tone } = STATUS[status];
  return (
    <li className="flex flex-col gap-1 rounded-lg border border-border p-3">
      <div className="flex items-center justify-between gap-3">
        <span className="font-medium">{document.title}</span>
        <span className="flex shrink-0 items-center gap-2">
          {!done && !gone && <Spinner label={`${label}…`} />}
          <Badge tone={tone}>{label}</Badge>
        </span>
      </div>
      {status === "FAILED" && (
        <p className="text-sm text-danger">
          {document.error ?? "We couldn't process these notes."}
        </p>
      )}
      {gone && (
        <p className="text-sm text-muted">
          This document is no longer available.
        </p>
      )}
      {retrying && (
        <p className="text-sm text-muted">
          Couldn&apos;t check the status. Trying again…
        </p>
      )}
    </li>
  );
}
