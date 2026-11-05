import { act, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ApiClient,
  DocumentState,
  DocumentSummary,
} from "@/lib/api-client";
import { DocumentList, MAX_POLL_MS, POLL_MS } from "./document-list";
import { errorResponse, networkClient } from "./test-clients";

const ID = "cdocument0000000000000099";

const doc = (overrides: Partial<DocumentSummary> = {}): DocumentSummary => ({
  id: ID,
  title: "Week 3",
  status: "QUEUED",
  createdAt: "2026-11-02T17:00:00.000Z",
  ...overrides,
});

const state = (
  status: DocumentState["status"],
  error?: string,
): DocumentState => ({ id: ID, status, error, conceptCount: 0 });

/** Holds the list like the course page does: each reported status replaces the document's. */
function Harness({
  client,
  initial,
}: {
  client: ApiClient;
  initial: DocumentSummary[];
}) {
  const [documents, setDocuments] = useState(initial);
  return (
    <DocumentList
      documents={documents}
      client={client}
      onStatus={({ id, status, error }) =>
        setDocuments((current) =>
          current.map((d) => (d.id === id ? { ...d, status, error } : d)),
        )
      }
    />
  );
}

/** Answers each poll with the next response; the last one repeats. */
function scripted(responses: (() => Response)[]) {
  let i = 0;
  return networkClient(async () =>
    responses[Math.min(i++, responses.length - 1)]!(),
  );
}

const tick = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("DocumentList", () => {
  it("says when there are no notes", () => {
    const { client } = networkClient(async () => Response.json({}));
    render(<Harness client={client} initial={[]} />);
    expect(screen.getByText("No notes uploaded yet.")).toBeInTheDocument();
  });

  it("polls every 2 s until READY, then stops", async () => {
    const { client, network } = scripted([
      () => Response.json(state("PROCESSING")),
      () => Response.json(state("READY")),
    ]);
    render(<Harness client={client} initial={[doc()]} />);
    expect(screen.getByText("Waiting")).toBeInTheDocument();
    expect(network).not.toHaveBeenCalled();

    await tick(POLL_MS);
    expect(network).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Processing")).toBeInTheDocument();

    await tick(POLL_MS);
    expect(network).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Ready")).toBeInTheDocument();

    await tick(POLL_MS * 10);
    expect(network).toHaveBeenCalledTimes(2);
  });

  it("stops at FAILED and shows the server's message", async () => {
    const { client, network } = scripted([
      () =>
        Response.json(
          state("FAILED", "We couldn't read any text in this file."),
        ),
    ]);
    render(<Harness client={client} initial={[doc()]} />);
    await tick(POLL_MS);
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(
      screen.getByText("We couldn't read any text in this file."),
    ).toBeInTheDocument();
    await tick(POLL_MS * 10);
    expect(network).toHaveBeenCalledOnce();
  });

  it("doesn't poll documents that are already done", async () => {
    const { client, network } = networkClient(async () => Response.json({}));
    render(
      <Harness
        client={client}
        initial={[
          doc({ id: "cdocument0000000000000001", status: "READY" }),
          doc({
            id: "cdocument0000000000000002",
            status: "FAILED",
            error: "Too short.",
          }),
        ]}
      />,
    );
    await tick(POLL_MS * 5);
    expect(network).not.toHaveBeenCalled();
    expect(screen.getByText("Too short.")).toBeInTheDocument();
  });

  it("waits twice as long after each failed poll, up to 30 s, then recovers", async () => {
    let failing = true;
    const { client, network } = networkClient(async () =>
      failing
        ? new Response("<html>bad gateway</html>", { status: 502 })
        : Response.json(state("READY")),
    );
    render(<Harness client={client} initial={[doc()]} />);

    await tick(POLL_MS); // 1st poll fails; next in 4 s
    expect(network).toHaveBeenCalledTimes(1);
    expect(
      screen.getByText("Couldn't check the status. Trying again…"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/bad gateway/)).toBeNull();

    await tick(4000 - 1);
    expect(network).toHaveBeenCalledTimes(1);
    await tick(1); // 2nd fails; next in 8 s
    expect(network).toHaveBeenCalledTimes(2);
    await tick(8000); // 3rd; next in 16 s
    await tick(16_000); // 4th; next in 30 s (capped)
    expect(network).toHaveBeenCalledTimes(4);
    await tick(MAX_POLL_MS - 1);
    expect(network).toHaveBeenCalledTimes(4);

    failing = false;
    await tick(1);
    expect(network).toHaveBeenCalledTimes(5);
    expect(screen.getByText("Ready")).toBeInTheDocument();
    expect(screen.queryByText(/Trying again/)).toBeNull();
  });

  it("stops polling a document that's gone", async () => {
    const { client, network } = networkClient(async () =>
      errorResponse(404, "NOT_FOUND", "Not found."),
    );
    render(<Harness client={client} initial={[doc()]} />);
    await tick(POLL_MS * 10);
    expect(network).toHaveBeenCalledOnce();
  });

  // PR #59 review: the row used to keep spinning, and after failed polls kept "Trying again…".
  it("says a gone document is no longer available, after failed polls too", async () => {
    const { client } = scripted([
      () => errorResponse(500, "INTERNAL", "Something went wrong."),
      () => errorResponse(404, "NOT_FOUND", "Not found."),
    ]);
    render(<Harness client={client} initial={[doc()]} />);
    await tick(POLL_MS);
    expect(screen.getByText(/Trying again/)).toBeInTheDocument();
    await tick(MAX_POLL_MS);
    expect(
      screen.getByText("This document is no longer available."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Trying again/)).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("stops polling and aborts the request on unmount", async () => {
    let signal: AbortSignal | undefined;
    const { client, network } = networkClient(
      (request) =>
        new Promise<Response>(() => {
          signal = request.signal;
        }),
    );
    const { unmount } = render(<Harness client={client} initial={[doc()]} />);
    await tick(POLL_MS);
    expect(network).toHaveBeenCalledOnce();
    unmount();
    expect(signal?.aborted).toBe(true);
    await tick(MAX_POLL_MS * 2);
    expect(network).toHaveBeenCalledOnce();
  });

  // Regression (PR #59 review): a fetch that ignores the signal and answers after unmount used to
  // carry on, report the status and schedule another poll that nothing cleared.
  it("stops polling when a request answers after unmount", async () => {
    let answer: (response: Response) => void = () => {};
    const { client, network } = networkClient(
      () => new Promise<Response>((resolve) => (answer = resolve)),
    );
    const { unmount } = render(<Harness client={client} initial={[doc()]} />);
    await tick(POLL_MS);
    expect(network).toHaveBeenCalledOnce();
    unmount();
    answer(Response.json(state("PROCESSING")));
    await tick(MAX_POLL_MS * 2);
    expect(network).toHaveBeenCalledOnce();
  });

  it("stops before the first poll when unmounted early", async () => {
    const { client, network } = networkClient(async () =>
      Response.json(state("READY")),
    );
    const { unmount } = render(<Harness client={client} initial={[doc()]} />);
    unmount();
    await tick(POLL_MS * 5);
    expect(network).not.toHaveBeenCalled();
  });

  it("renders an HTML-looking title as text", () => {
    const { client } = networkClient(async () => Response.json({}));
    const title = '<img src=x onerror="alert(1)">';
    const { container } = render(
      <Harness client={client} initial={[doc({ title, status: "READY" })]} />,
    );
    expect(screen.getByText(title)).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
  });
});
