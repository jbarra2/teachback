import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SignupForm } from "./signup-form";

const field = (label: string) => screen.getByLabelText(label);
const submit = () =>
  fireEvent.click(screen.getByRole("button", { name: "Create account" }));

function type(label: string, value: string) {
  fireEvent.change(field(label), { target: { value } });
}

describe("SignupForm", () => {
  it("labels every field, with a new-password hint", () => {
    render(<SignupForm />);
    expect(field("Name")).toHaveAttribute("autocomplete", "name");
    expect(field("Email")).toHaveAttribute("type", "email");
    expect(field("Password")).toHaveAttribute("autocomplete", "new-password");
    expect(field("Password")).toHaveAccessibleDescription("8–128 characters.");
  });

  it("flags every field on an empty submit and focuses the name", () => {
    render(<SignupForm />);
    submit();
    expect(screen.getByText("Enter your name.")).toBeInTheDocument();
    expect(screen.getByText("Enter your email address.")).toBeInTheDocument();
    expect(screen.getByText("Enter your password.")).toBeInTheDocument();
    expect(field("Name")).toHaveFocus();
  });

  it("rejects a bad email and a short password", () => {
    render(<SignupForm />);
    type("Name", "Ada");
    type("Email", "ada@example");
    type("Password", "1234567");
    submit();
    expect(field("Email")).toHaveFocus();
    expect(field("Email")).toHaveAttribute("aria-invalid", "true");
    expect(field("Password")).toHaveAccessibleDescription(
      "8–128 characters. Use at least 8 characters.",
    );
  });

  it("caps the name at its limit", () => {
    render(<SignupForm />);
    expect(field("Name")).toHaveAttribute("maxlength", "100");
  });

  it("passes valid values to onSubmit", () => {
    const onSubmit = vi.fn();
    render(<SignupForm onSubmit={onSubmit} />);
    type("Name", "Ada Lovelace");
    type("Email", "ada@example.com");
    type("Password", "analytical engine");
    submit();
    expect(onSubmit).toHaveBeenCalledWith({
      name: "Ada Lovelace",
      email: "ada@example.com",
      password: "analytical engine",
    });
  });

  it("links to log in", () => {
    render(<SignupForm />);
    expect(screen.getByRole("link", { name: "Log in" })).toHaveAttribute(
      "href",
      "/login",
    );
  });
});
