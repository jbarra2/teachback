// The map page passes its course to the map and the Practice weakest button (T26).
// The map itself is tested in src/components/map.
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import MapPage from "./page";

vi.mock("@/components/map/concept-map", () => ({
  ConceptMap: ({ courseId }: { courseId: string }) => <p>map for {courseId}</p>,
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
});
