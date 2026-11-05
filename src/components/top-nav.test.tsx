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
});
