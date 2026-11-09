// The app pages and the loading / not-found boundaries of the app routes. The client parts the pages
// render are tested in src/components.
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import RootNotFound from "../not-found";
import CoursePage from "./courses/[courseId]/page";
import PracticeWeakestPage from "./courses/[courseId]/practice/weakest/page";
import CoursesPage from "./courses/page";
import AppLoading from "./loading";
import AppNotFound from "./not-found";

vi.mock("@/components/notes/course-library", () => ({
  CourseLibrary: () => <p>course library</p>,
}));
vi.mock("@/components/practice/weakest-practice", () => ({
  WeakestPractice: ({ courseId }: { courseId: string }) => (
    <p>weakest practice for {courseId}</p>
  ),
}));
// The stand-in shows the actions the page hands it in a region of their own; the real one shows
// them only for a course it loaded (tested in src/components/notes).
vi.mock("@/components/notes/course-notes", () => ({
  CourseNotes: ({
    courseId,
    actions,
  }: {
    courseId: string;
    actions?: ReactNode;
  }) => (
    <>
      <p>notes for {courseId}</p>
      <section aria-label="Actions slot">{actions}</section>
    </>
  ),
}));

describe("pages", () => {
  it("renders /courses with the course library", () => {
    render(<CoursesPage />);
    expect(
      screen.getByRole("heading", { level: 1, name: "Your courses" }),
    ).toBeInTheDocument();
    expect(screen.getByText("course library")).toBeInTheDocument();
  });

  it("renders /courses/[courseId] with its notes and links to practice and the map", async () => {
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
    expect(
      screen.getByRole("link", { name: "Practice weakest" }),
    ).toHaveAttribute("href", "/courses/c1/practice/weakest");
    expect(screen.getByText("notes for c1")).toBeInTheDocument();
  });

  // T32: these were 20–36 px tall at 390 px wide.
  it("makes the course's links at least 44 px tall to tap", async () => {
    render(
      await CoursePage({
        params: Promise.resolve({ courseId: "c1" }),
        searchParams: Promise.resolve({}),
      }),
    );
    for (const name of ["Practice", "Concept map", "Practice weakest"])
      expect(screen.getByRole("link", { name })).toHaveClass(
        "inline-flex",
        "min-h-11",
      );
  });

  // T32: the links go to CourseNotes, which shows them only once the course loads, never above
  // "Course not found". Rendered next to it, they'd show for any course id.
  it("hands every course link to the notes instead of rendering them itself", async () => {
    render(
      await CoursePage({
        params: Promise.resolve({ courseId: "c1" }),
        searchParams: Promise.resolve({}),
      }),
    );
    const slot = screen.getByRole("region", { name: "Actions slot" });
    expect(screen.getAllByRole("link")).toHaveLength(3);
    for (const link of screen.getAllByRole("link"))
      expect(slot).toContainElement(link);
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
    expect(
      screen.getByRole("link", { name: "Practice weakest" }),
    ).toHaveAttribute("href", "/courses/a%2Fb%3Fc/practice/weakest");
  });

  it("renders the Practice weakest page for its course", async () => {
    render(
      await PracticeWeakestPage({
        params: Promise.resolve({ courseId: "c1" }),
        searchParams: Promise.resolve({}),
      }),
    );
    expect(
      screen.getByRole("heading", { level: 1, name: "Practice weakest" }),
    ).toBeInTheDocument();
    expect(screen.getByText("weakest practice for c1")).toBeInTheDocument();
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
