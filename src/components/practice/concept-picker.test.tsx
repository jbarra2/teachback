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

  it("points to the course page when there are no concepts", async () => {
    render(<ConceptPicker courseId={COURSE_2_ID} client={mockClient()} />);
    expect(
      await screen.findByRole("heading", { name: "No concepts yet" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Go to the course" }),
    ).toHaveAttribute("href", `/courses/${COURSE_2_ID}`);
  });

  it("shows the error and retries", async () => {
    let calls = 0;
    const client = mockClient(async () => {
      calls += 1;
      return calls === 1
        ? Response.json(
            { error: { code: "NOT_FOUND", message: "Not found." } },
            { status: 404 },
          )
        : Response.json(concepts);
    });
    render(<ConceptPicker courseId={COURSE_ID} client={client} />);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Couldn't load concepts");
    expect(alert).toHaveTextContent("Not found.");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(
      await screen.findByRole("link", { name: "Osmosis" }),
    ).toBeInTheDocument();
  });
});
