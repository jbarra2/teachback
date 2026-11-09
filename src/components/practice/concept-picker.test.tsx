import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createApiClient } from "@/lib/api-client";
import { createFakeFetch } from "@/lib/api-client/fake-api/fake-fetch";
import {
  COURSE_2_ID,
  COURSE_ID,
  concepts,
} from "@/lib/api-client/fake-api/fixtures";
import { ConceptPicker } from "./concept-picker";

function mockClient(network?: (request: Request) => Promise<Response>) {
  return createApiClient({
    baseUrl: "http://test.local",
    fetch: network ?? createFakeFetch(),
    onUnauthenticated: vi.fn(),
  });
}

describe("ConceptPicker", () => {
  it("lists each concept as a practice link with its mastery state", async () => {
    render(<ConceptPicker courseId={COURSE_ID} client={mockClient()} />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading concepts…");
    const osmosis = await screen.findByRole("link", { name: "Osmosis" });
    expect(osmosis).toHaveAttribute(
      "href",
      `/courses/${COURSE_ID}/practice?concept=${concepts[2]!.id}`,
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(concepts.length);
    expect(screen.getByText("Seems understood")).toBeInTheDocument();
  });

  // T32: these were 24 px tall at 390 px wide (browser walk).
  it("makes each concept link at least 44 px tall to tap", async () => {
    render(<ConceptPicker courseId={COURSE_ID} client={mockClient()} />);
    await screen.findByRole("link", { name: "Osmosis" });
    for (const concept of concepts)
      expect(screen.getByRole("link", { name: concept.name })).toHaveClass(
        "min-h-11",
      );
  });

  it("points to the course page when there are no concepts", async () => {
    render(<ConceptPicker courseId={COURSE_2_ID} client={mockClient()} />);
    expect(
      await screen.findByRole("heading", { name: "No concepts yet" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Go to the course" }),
    ).toHaveAttribute("href", `/courses/${COURSE_2_ID}`);
    // T32: a way out that stands alone, so it's tap-sized (44 px).
    expect(screen.getByRole("link", { name: "Go to the course" })).toHaveClass(
      "min-h-11",
    );
  });

  // T32: like the course page, another student's course (or an unknown or malformed id) is "not
  // found", not an error to retry.
  it.each([
    ["another student's course or an unknown id", 404, "NOT_FOUND"],
    ["a malformed id", 400, "VALIDATION_ERROR"],
  ])("says %s isn't found, with a way back", async (_name, status, code) => {
    render(
      <ConceptPicker
        courseId={COURSE_ID}
        client={mockClient(async () =>
          Response.json({ error: { code, message: "Nope." } }, { status }),
        )}
      />,
    );
    expect(
      await screen.findByRole("heading", { name: "Course not found" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Back to your courses" }),
    ).toHaveAttribute("href", "/courses");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows the error and retries", async () => {
    let calls = 0;
    const client = mockClient(async () => {
      calls += 1;
      return calls === 1
        ? Response.json(
            { error: { code: "INTERNAL", message: "Something went wrong." } },
            { status: 500 },
          )
        : Response.json(concepts);
    });
    render(<ConceptPicker courseId={COURSE_ID} client={client} />);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Couldn't load concepts");
    expect(alert).toHaveTextContent("Something went wrong.");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(
      await screen.findByRole("link", { name: "Osmosis" }),
    ).toBeInTheDocument();
  });
});
