import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { COURSE_ID, concepts } from "@/lib/api-client/fake-api/fixtures";
import { ConceptList } from "./concept-list";

describe("ConceptList", () => {
  it("says when there are no concepts yet", () => {
    render(<ConceptList courseId={COURSE_ID} concepts={[]} />);
    expect(screen.getByText(/No concepts yet/)).toBeInTheDocument();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("shows each concept's name, summary and state in words", () => {
    const [first] = concepts;
    render(<ConceptList courseId={COURSE_ID} concepts={[first!]} />);
    expect(screen.getByRole("link", { name: first!.name })).toBeInTheDocument();
    expect(screen.getByText(first!.summary)).toBeInTheDocument();
    expect(screen.getByText("Seems understood")).toBeInTheDocument();
  });

  it("encodes the ids in the practice link", () => {
    render(
      <ConceptList
        courseId="a/b"
        concepts={[{ ...concepts[0]!, id: "c?d" }]}
      />,
    );
    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      "/courses/a%2Fb/practice?concept=c%3Fd",
    );
  });
});
