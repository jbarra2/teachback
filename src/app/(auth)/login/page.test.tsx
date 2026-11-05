// The login page hands ?next= to the form, which only follows a path on this site (login-form.test.tsx).
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import LoginPage from "./page";

vi.mock("@/components/auth/login-form", () => ({
  LoginForm: ({ next }: { next?: string }) => <p>next: {next ?? "none"}</p>,
}));

async function renderWith(next?: string | string[]) {
  render(
    await LoginPage({
      params: Promise.resolve({}),
      searchParams: Promise.resolve(next === undefined ? {} : { next }),
    }),
  );
}

describe("LoginPage", () => {
  it("passes ?next= to the form", async () => {
    await renderWith("/courses/c1");
    expect(
      screen.getByRole("heading", { level: 1, name: "Log in" }),
    ).toBeInTheDocument();
    expect(screen.getByText("next: /courses/c1")).toBeInTheDocument();
  });

  it("ignores a missing or repeated ?next=", async () => {
    await renderWith(["/a", "/b"]);
    expect(screen.getByText("next: none")).toBeInTheDocument();
  });
});
