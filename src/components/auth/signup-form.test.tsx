import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SIGNUP_LOGIN_FAILED } from "./auth-actions";
import { SignupForm } from "./signup-form";

const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

// The real action is tested in auth-actions.test.ts; here a stand-in keeps the network out.
const ok = vi.fn(async () => undefined);

beforeEach(() => {
  router.replace.mockClear();
  ok.mockClear();
});

const field = (label: string) => screen.getByLabelText(label);
const submit = () =>
  fireEvent.click(screen.getByRole("button", { name: "Create account" }));

function type(label: string, value: string) {
  fireEvent.change(field(label), { target: { value } });
}

describe("SignupForm", () => {
  it("labels every field, with a new-password hint", () => {
    render(<SignupForm onSubmit={ok} />);
    expect(field("Name")).toHaveAttribute("autocomplete", "name");
    expect(field("Email")).toHaveAttribute("type", "email");
    expect(field("Password")).toHaveAttribute("autocomplete", "new-password");
    expect(field("Password")).toHaveAccessibleDescription("8–128 characters.");
  });

  it("flags every field on an empty submit and focuses the name", () => {
    render(<SignupForm onSubmit={ok} />);
    submit();
    expect(screen.getByText("Enter your name.")).toBeInTheDocument();
    expect(screen.getByText("Enter your email address.")).toBeInTheDocument();
    expect(screen.getByText("Enter your password.")).toBeInTheDocument();
    expect(field("Name")).toHaveFocus();
  });

  it("rejects a bad email and a short password", () => {
    render(<SignupForm onSubmit={ok} />);
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
    render(<SignupForm onSubmit={ok} />);
    expect(field("Name")).toHaveAttribute("maxlength", "100");
  });

  it("passes valid values to onSubmit, then goes to /courses", async () => {
    render(<SignupForm onSubmit={ok} />);
    type("Name", "Ada Lovelace");
    type("Email", "ada@example.com");
    type("Password", "analytical engine");
    await act(async () => submit());
    expect(ok).toHaveBeenCalledWith({
      name: "Ada Lovelace",
      email: "ada@example.com",
      password: "analytical engine",
    });
    expect(router.replace).toHaveBeenCalledWith("/courses");
  });

  it("shows the failure message and stays on the page", async () => {
    const onSubmit = vi.fn(async () => SIGNUP_LOGIN_FAILED);
    render(<SignupForm onSubmit={onSubmit} />);
    type("Name", "Ada Lovelace");
    type("Email", "ada@example.com");
    type("Password", "analytical engine");
    await act(async () => submit());
    expect(screen.getByRole("status")).toHaveTextContent(SIGNUP_LOGIN_FAILED);
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("links to log in", () => {
    render(<SignupForm onSubmit={ok} />);
    expect(screen.getByRole("link", { name: "Log in" })).toHaveAttribute(
      "href",
      "/login",
    );
  });
});
