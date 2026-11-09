import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TopNav } from "./top-nav";

// The session-dependent links are tested in nav-auth.test.tsx.
vi.mock("./nav-auth", () => ({
  NavAuth: () => <li>session links</li>,
  navLink: "nav-link",
}));

describe("TopNav", () => {
  it("links home and to the courses, then the session links", () => {
    render(<TopNav />);
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(nav).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "TeachBack" })).toHaveAttribute(
      "href",
      "/",
    );
    expect(screen.getByRole("link", { name: "Courses" })).toHaveAttribute(
      "href",
      "/courses",
    );
    expect(screen.getByText("session links")).toBeInTheDocument();
  });

  // T32: the brand link was 28 px tall at 390 px wide.
  it("makes the home link at least 44 px tall to tap", () => {
    render(<TopNav />);
    // min-height does nothing on an inline link: inline-flex is part of the fix.
    expect(screen.getByRole("link", { name: "TeachBack" })).toHaveClass(
      "inline-flex",
      "min-h-11",
    );
  });

  it("wraps onto a second line instead of overflowing a 375 px screen", () => {
    render(<TopNav />);
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(nav).toHaveClass("flex-wrap");
    expect(screen.getByRole("list")).toHaveClass("flex-wrap");
  });
});
