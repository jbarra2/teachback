import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "@/lib/api-client";
import { GENERIC_MESSAGE } from "@/lib/api-client/errors";
import {
  CONCEPT_IDS,
  COURSE_2_ID,
  COURSE_ID,
  concepts,
  courses,
} from "@/lib/api-client/fake-api/fixtures";
import { createFakeFetch } from "@/lib/api-client/fake-api/fake-fetch";
import { POLL_MS } from "./document-list";
import { CourseNotes } from "./course-notes";
import { errorResponse, mockClient, networkClient } from "./test-clients";

afterEach(() => {
  vi.useRealTimers();
});

/** The paths the client has been asked to GET, in order. */
function spyPaths(client: ApiClient) {
  const get = vi.spyOn(client, "GET");
  // GET is overloaded per path, so the spy can't type its calls.
  return () => (get.mock.calls as unknown as [string][]).map(([path]) => path);
}

const concepts$ = () => screen.getByRole("list", { name: "Concepts" });

describe("CourseNotes", () => {
  it("shows the course, its notes with their status, and its concepts", async () => {
    render(<CourseNotes courseId={COURSE_ID} client={mockClient()} />);
    expect(
      await screen.findByRole("heading", { name: courses[0]!.name }),
    ).toBeInTheDocument();
    const notes = screen.getByRole("list", { name: "Your notes" });
    expect(within(notes).getByText("Week 1 - Cells")).toBeInTheDocument();
    expect(within(notes).getByText("Ready")).toBeInTheDocument();
    expect(within(notes).getByText("Failed")).toBeInTheDocument();
    expect(
      within(notes).getByText("We couldn't read any text in this file."),
    ).toBeInTheDocument();

    await screen.findByRole("list", { name: "Concepts" });
    expect(within(concepts$()).getAllByRole("listitem")).toHaveLength(
      concepts.length,
    );
    expect(
      within(concepts$()).getByRole("link", { name: "Osmosis" }),
    ).toHaveAttribute(
      "href",
      `/courses/${COURSE_ID}/practice?concept=${CONCEPT_IDS.osmosis}`,
    );
    expect(within(concepts$()).getAllByText("Practice").length).toBeGreaterThan(
      0,
    );
  });

  it("doesn't load concepts before any notes are ready", async () => {
    const client = mockClient();
    const paths = spyPaths(client);
    render(<CourseNotes courseId={COURSE_2_ID} client={client} />);
    expect(
      await screen.findByText("No notes uploaded yet."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Concepts appear here once your notes are processed."),
    ).toBeInTheDocument();
    expect(paths()).toEqual(["/api/courses/{id}"]);
  });

  it("adds an upload to the list, polls it to READY and reloads the concepts", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const client = mockClient();
    const paths = spyPaths(client);
    const conceptLoads = () =>
      paths().filter((path) => path === "/api/courses/{id}/concepts").length;
    render(<CourseNotes courseId={COURSE_ID} client={client} />);
    await screen.findByRole("list", { name: "Concepts" });
    expect(conceptLoads()).toBe(1);

    fireEvent.click(screen.getByRole("radio", { name: "Pasted text" }));
    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Week 5" },
    });
    fireEvent.change(screen.getByLabelText("Pasted notes"), {
      target: { value: "Diffusion moves particles." },
    });
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: /Upload/ })),
    );
    const notes = screen.getByRole("list", { name: "Your notes" });
    const row = (await within(notes).findByText("Week 5")).closest("li")!;
    expect(within(row).getByText("Waiting")).toBeInTheDocument();

    await act(() => vi.advanceTimersByTimeAsync(POLL_MS));
    expect(await within(row).findByText("Processing")).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS));
    expect(await within(row).findByText("Ready")).toBeInTheDocument();
    await vi.waitFor(() => expect(conceptLoads()).toBe(2));
  });

  it("says the course wasn't found for an unknown id", async () => {
    render(
      <CourseNotes
        courseId="cnope000000000000000000001"
        client={mockClient()}
      />,
    );
    expect(await screen.findByText("Course not found")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Back to your courses" }),
    ).toHaveAttribute("href", "/courses");
  });

  it("says the course wasn't found for a malformed id", async () => {
    render(<CourseNotes courseId="not-an-id" client={mockClient()} />);
    expect(await screen.findByText("Course not found")).toBeInTheDocument();
  });

  it("shows a safe message when loading fails, and retries", async () => {
    let fail = true;
    const { client } = networkClient(async () =>
      fail
        ? new Response("<html>stack trace</html>", { status: 500 })
        : Response.json({
            ...courses[1],
            documents: [],
          }),
    );
    render(<CourseNotes courseId={COURSE_2_ID} client={client} />);
    expect(
      await screen.findByText("Couldn't load the course"),
    ).toBeInTheDocument();
    expect(screen.getByText(GENERIC_MESSAGE)).toBeInTheDocument();
    expect(screen.queryByText(/stack trace/)).toBeNull();
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(
      await screen.findByText("No notes uploaded yet."),
    ).toBeInTheDocument();
  });

  it("shows an error for the concepts alone, and retries them", async () => {
    let failConcepts = true;
    const course = {
      ...courses[0],
      documents: [
        {
          id: "cdocument0000000000000001",
          title: "Week 1",
          status: "READY",
          createdAt: "2026-10-20T17:05:00.000Z",
        },
      ],
    };
    const { client } = networkClient(async (request) => {
      if (!request.url.endsWith("/concepts")) return Response.json(course);
      return failConcepts
        ? errorResponse(500, "INTERNAL", "Something went wrong.")
        : Response.json(concepts);
    });
    render(<CourseNotes courseId={COURSE_ID} client={client} />);
    expect(
      await screen.findByText("Couldn't load the concepts"),
    ).toBeInTheDocument();
    expect(screen.getByText("Week 1")).toBeInTheDocument();
    failConcepts = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByRole("list", { name: "Concepts" });
  });

  it("renders HTML-looking names and summaries as text", async () => {
    const html = '<img src=x onerror="alert(1)">';
    const { client } = networkClient(async (request) =>
      request.url.endsWith("/concepts")
        ? Response.json([{ ...concepts[0], name: html, summary: html }])
        : Response.json({
            ...courses[0],
            name: html,
            documents: [
              {
                id: "cdocument0000000000000001",
                title: html,
                status: "READY",
                createdAt: "2026-10-20T17:05:00.000Z",
              },
            ],
          }),
    );
    const { container } = render(
      <CourseNotes courseId={COURSE_ID} client={client} />,
    );
    await screen.findByRole("list", { name: "Concepts" });
    expect(screen.getAllByText(html)).toHaveLength(4);
    expect(container.querySelector("img")).toBeNull();
  });

  // Regression (PR #59 review): an answer for the previous course, arriving after the switch,
  // used to replace the current one.
  it("ignores a late answer for a course it has moved away from", async () => {
    const fake = createFakeFetch();
    let releaseFirst: () => void = () => {};
    const firstHeld = new Promise<void>((resolve) => (releaseFirst = resolve));
    const { client } = networkClient(async (request) => {
      if (new URL(request.url).pathname !== `/api/courses/${COURSE_ID}`)
        return fake(request);
      // Like a server that answers anyway: the copy drops the (by then aborted) signal.
      await firstHeld;
      return fake(new Request(request.url));
    });
    const { rerender } = render(
      <CourseNotes courseId={COURSE_ID} client={client} />,
    );
    rerender(<CourseNotes courseId={COURSE_2_ID} client={client} />);
    expect(
      await screen.findByRole("heading", { name: courses[1]!.name }),
    ).toBeInTheDocument();

    await act(async () => releaseFirst());
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(
      screen.getByRole("heading", { name: courses[1]!.name }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: courses[0]!.name }),
    ).not.toBeInTheDocument();
  });

  it("aborts its requests on unmount", async () => {
    let signal: AbortSignal | undefined;
    const { client } = networkClient(
      (request) =>
        new Promise<Response>(() => {
          signal = request.signal;
        }),
    );
    const { unmount } = render(
      <CourseNotes courseId={COURSE_ID} client={client} />,
    );
    await vi.waitFor(() => expect(signal).toBeDefined());
    unmount();
    expect(signal?.aborted).toBe(true);
  });
});
