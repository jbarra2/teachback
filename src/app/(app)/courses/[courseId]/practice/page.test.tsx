// Which screen /courses/[courseId]/practice shows. The screens themselves are tested in
// src/components/practice.
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import PracticePage from "./page";

vi.mock("@/components/practice/concept-picker", () => ({
  ConceptPicker: ({ courseId }: { courseId: string }) => (
    <p>picker for {courseId}</p>
  ),
}));
vi.mock("@/components/practice/practice-session", () => ({
  PracticeSession: (props: { courseId: string; conceptId: string }) => (
    <p>
      session for {props.courseId} / {props.conceptId}
    </p>
  ),
}));

async function renderPage(concept?: string | string[]) {
  render(
    await PracticePage({
      params: Promise.resolve({ courseId: "c1" }),
      searchParams: Promise.resolve(concept === undefined ? {} : { concept }),
    }),
  );
}

describe("PracticePage", () => {
  it("shows the concept picker when no concept is given", async () => {
    await renderPage();
    expect(
      screen.getByRole("heading", { level: 1, name: "Practice" }),
    ).toBeInTheDocument();
    expect(screen.getByText("picker for c1")).toBeInTheDocument();
  });

  it("starts a session for ?concept=", async () => {
    await renderPage("cconcept00000000000000003");
    expect(
      screen.getByText("session for c1 / cconcept00000000000000003"),
    ).toBeInTheDocument();
  });

  it("uses the first of repeated ?concept= values", async () => {
    await renderPage([
      "cconcept00000000000000003",
      "cconcept00000000000000004",
    ]);
    expect(
      screen.getByText("session for c1 / cconcept00000000000000003"),
    ).toBeInTheDocument();
  });

  it("treats an empty ?concept= as none", async () => {
    await renderPage("");
    expect(screen.getByText("picker for c1")).toBeInTheDocument();
  });
});
