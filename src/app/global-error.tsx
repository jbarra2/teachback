"use client";
// Replaces the root layout when it fails, so it brings its own <html>, <body> and styles.
import { RouteError } from "@/components/route-error";
import "./globals.css";

export default function GlobalError({
  error,
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  return (
    <html lang="en">
      <body className="mx-auto max-w-5xl px-4">
        <title>Something went wrong · TeachBack</title>
        <RouteError error={error} retry={retry} />
      </body>
    </html>
  );
}
