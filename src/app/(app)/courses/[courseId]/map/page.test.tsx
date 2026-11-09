// The map page passes its course to the map and the Practice weakest button (T26).
// The map itself is tested in src/components/map.
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import MapPage from "./page";

// The stand-in shows the actions the page hands it in a region of their own; the real map shows
// them only for a course it loaded (tested in src/components/map).
vi.mock("@/components/map/concept-map", () => ({
  ConceptMap: ({
    courseId,
    actions,
  }: {
    courseId: string;
    actions?: ReactNode;
  }) => (
    <>
      <p>map for {courseId}</p>
      <section aria-label="Actions slot">{actions}</section>
    </>
  ),
}));

describe("MapPage", () => {
  it("renders the map for the course in the URL", async () => {
    render(
      await MapPage({
        params: Promise.resolve({ courseId: "c1" }),
        searchParams: Promise.resolve({}),
      }),
    );
    expect(
      screen.getByRole("heading", { level: 1, name: "Concept map" }),
    ).toBeInTheDocument();
    expect(screen.getByText("map for c1")).toBeInTheDocument();
  });

  it("links to Practice weakest for the course, encoding its id", async () => {
    render(
      await MapPage({
        params: Promise.resolve({ courseId: "a/b?c" }),
        searchParams: Promise.resolve({}),
      }),
    );
    expect(
      screen.getByRole("link", { name: "Practice weakest" }),
    ).toHaveAttribute("href", "/courses/a%2Fb%3Fc/practice/weakest");
  });

  // T32: handed to the map, which shows it only once the map loads, never above "Course not found".
  it("hands Practice weakest to the map instead of rendering it itself", async () => {
    render(
      await MapPage({
        params: Promise.resolve({ courseId: "c1" }),
        searchParams: Promise.resolve({}),
      }),
    );
    expect(
      screen.getByRole("region", { name: "Actions slot" }),
    ).toContainElement(screen.getByRole("link", { name: "Practice weakest" }));
    // Right-aligned rather than stretched across the map's column.
    expect(
      screen.getByRole("link", { name: "Practice weakest" }).parentElement,
    ).toHaveClass("flex", "justify-end");
  });
});
