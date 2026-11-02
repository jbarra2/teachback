import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LoginForm } from "./login-form";
import { NOT_CONNECTED, SUBMIT_FAILED } from "./use-auth-form";

const email = () => screen.getByLabelText("Email");
const password = () => screen.getByLabelText("Password");
const submit = () =>
  fireEvent.click(screen.getByRole("button", { name: "Log in" }));

function type(input: HTMLElement, value: string) {
  fireEvent.change(input, { target: { value } });
}

describe("LoginForm", () => {
  it("labels every field and uses the right input types", () => {
    render(<LoginForm />);
    expect(email()).toHaveAttribute("type", "email");
    expect(email()).toHaveAttribute("autocomplete", "email");
    expect(password()).toHaveAttribute("type", "password");
    expect(password()).toHaveAttribute("autocomplete", "current-password");
  });

  it("shows no errors before the first submit", () => {
    render(<LoginForm />);
    type(email(), "nope");
    expect(screen.queryByText(/valid email/)).not.toBeInTheDocument();
    expect(email()).not.toHaveAttribute("aria-invalid");
  });

  it("flags both fields on an empty submit and focuses the first", () => {
    render(<LoginForm />);
    submit();
    expect(screen.getByText("Enter your email address.")).toBeInTheDocument();
    expect(screen.getByText("Enter your password.")).toBeInTheDocument();
    expect(email()).toHaveAttribute("aria-invalid", "true");
    expect(email()).toHaveFocus();
  });

  it("links each error to its field for screen readers", () => {
    render(<LoginForm />);
    type(email(), "not-an-email");
    type(password(), "short");
    submit();
    expect(email()).toHaveAccessibleDescription(
      "Enter a valid email address, like name@example.com.",
    );
    expect(password()).toHaveAccessibleDescription(
      "Use at least 8 characters.",
    );
  });

  it("focuses the password when only it is wrong", () => {
    render(<LoginForm />);
    type(email(), "ada@example.com");
    type(password(), "1234567");
    submit();
    expect(password()).toHaveFocus();
  });

  it("clears an error as soon as the field is fixed", () => {
    render(<LoginForm />);
    submit();
    type(email(), "ada@example.com");
    expect(
      screen.queryByText("Enter your email address."),
    ).not.toBeInTheDocument();
    expect(email()).not.toHaveAttribute("aria-invalid");
    expect(screen.getByText("Enter your password.")).toBeInTheDocument();
  });

  it("says sign-in isn't connected when nothing handles the submit", () => {
    render(<LoginForm />);
    type(email(), "ada@example.com");
    type(password(), "correct horse");
    submit();
    expect(screen.getByRole("status")).toHaveTextContent(NOT_CONNECTED);
  });

  it("passes valid values to onSubmit, once, while the button is busy", async () => {
    let finish = () => {};
    const onSubmit = vi.fn(
      () => new Promise<void>((resolve) => (finish = resolve)),
    );
    render(<LoginForm onSubmit={onSubmit} />);
    type(email(), "ada@example.com");
    type(password(), "correct horse");
    submit();
    const button = screen.getByRole("button", { name: /Log in/ });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    // A second click, and a second submit that skips the disabled button (Enter in a field).
    fireEvent.click(button);
    fireEvent.submit(screen.getByRole("form", { name: "Log in" }));
    expect(onSubmit).toHaveBeenCalledOnce();
    expect(onSubmit).toHaveBeenCalledWith({
      email: "ada@example.com",
      password: "correct horse",
    });
    await act(async () => finish());
    expect(button).toBeEnabled();
  });

  it("doesn't call onSubmit when a field is invalid", () => {
    const onSubmit = vi.fn();
    render(<LoginForm onSubmit={onSubmit} />);
    type(email(), "ada@example.com");
    submit();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("shows a generic message, not the cause, when onSubmit fails", async () => {
    const onSubmit = vi.fn(async () => {
      throw new Error("db password=hunter2");
    });
    render(<LoginForm onSubmit={onSubmit} />);
    type(email(), "ada@example.com");
    type(password(), "correct horse");
    await act(async () => submit());
    expect(screen.getByRole("status")).toHaveTextContent(SUBMIT_FAILED);
    expect(screen.queryByText(/hunter2/)).not.toBeInTheDocument();
  });

  it("links to sign up", () => {
    render(<LoginForm />);
    expect(
      screen.getByRole("link", { name: "Create an account" }),
    ).toHaveAttribute("href", "/signup");
  });
});
