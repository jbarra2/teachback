// The placeholder pages and the loading / not-found boundaries of the app routes.
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import RootNotFound from "../not-found";
import CoursePage from "./courses/[courseId]/page";
import MapPage from "./courses/[courseId]/map/page";
import PracticePage from "./courses/[courseId]/practice/page";
import CoursesPage from "./courses/page";
import AppLoading from "./loading";
import AppNotFound from "./not-found";

describe("placeholder pages", () => {
  it("renders /courses with an empty state", () => {
    render(<CoursesPage />);
    expect(
      screen.getByRole("heading", { level: 1, name: "Your courses" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "No courses yet" }),
    ).toBeInTheDocument();
  });

  it("renders /courses/[courseId] with links to practice and the map", async () => {
    render(
      await CoursePage({
        params: Promise.resolve({ courseId: "c1" }),
        searchParams: Promise.resolve({}),
      }),
    );
    expect(
      screen.getByRole("heading", { level: 1, name: "Course" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Practice" })).toHaveAttribute(
      "href",
      "/courses/c1/practice",
    );
    expect(screen.getByRole("link", { name: "Concept map" })).toHaveAttribute(
      "href",
      "/courses/c1/map",
    );
  });

  it("encodes the course id in its links", async () => {
    render(
      await CoursePage({
        params: Promise.resolve({ courseId: "a/b?c" }),
        searchParams: Promise.resolve({}),
      }),
    );
    expect(screen.getByRole("link", { name: "Practice" })).toHaveAttribute(
      "href",
      "/courses/a%2Fb%3Fc/practice",
    );
  });

  it.each([
    ["Practice", PracticePage],
    ["Concept map", MapPage],
  ])("renders the %s page", (heading, Page) => {
    render(<Page />);
    expect(
      screen.getByRole("heading", { level: 1, name: heading }),
    ).toBeInTheDocument();
  });
});

describe("loading", () => {
  it("announces loading to screen readers", () => {
    render(<AppLoading />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading…");
  });
});

describe.each([
  ["app routes", AppNotFound],
  ["unknown URLs", RootNotFound],
])("not found (%s)", (_label, NotFound) => {
  it("explains and links back to courses", () => {
    render(<NotFound />);
    expect(
      screen.getByRole("heading", { name: "Page not found" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Back to my courses" }),
    ).toHaveAttribute("href", "/courses");
  });
});
