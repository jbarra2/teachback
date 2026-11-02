"use client";
// What an error boundary shows. Never the thrown message or stack: in development Next forwards
// the real message, and it can hold anything (SQL, ids, secrets).
import { ErrorState } from "@/components/ui";

/** Next's hash of a server error, for matching the server logs. Only a short token is shown. */
export function errorDigest(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("digest" in error))
    return undefined;
  const { digest } = error;
  return typeof digest === "string" && /^[\w-]{1,64}$/.test(digest)
    ? digest
    : undefined;
}

export function RouteError({
  error,
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  const digest = errorDigest(error);
  return (
    <div className="flex flex-col items-center gap-2 py-12">
      <ErrorState
        title="Something went wrong"
        message="This page couldn't load. Please try again."
        onRetry={retry}
      />
      {digest && <p className="text-xs text-muted">Reference: {digest}</p>}
    </div>
  );
}
