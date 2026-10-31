import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import Home from "@/app/page";

// Sample component test: *.test.tsx runs in jsdom with Testing Library and jest-dom matchers.
describe("home page", () => {
  let previousTestRendered = false;

  it("runs in a DOM environment", () => {
    expect(typeof window).toBe("object");
    expect(typeof document).toBe("object");
  });

  it("renders the TeachBack heading", () => {
    render(<Home />);
    previousTestRendered = true;
    expect(
      screen.getByRole("heading", { level: 1, name: "TeachBack" }),
    ).toBeInTheDocument();
  });

  // vitest.setup.ts unmounts after each test; without it this test would see two headings.
  // It relies on the test above having rendered, so it refuses to pass if run alone or shuffled.
  it("starts each test with an empty DOM", () => {
    expect(previousTestRendered).toBe(true);
    expect(document.body).toBeEmptyDOMElement();
    render(<Home />);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });
});
