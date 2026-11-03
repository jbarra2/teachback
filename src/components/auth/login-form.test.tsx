import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GENERIC_MESSAGE } from "@/lib/api-client/errors";
import { RATE_LIMITED } from "./auth-actions";
import { LoginForm } from "./login-form";

const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

// The real action is tested in auth-actions.test.ts; here a stand-in keeps the network out.
const ok = vi.fn(async () => undefined);

beforeEach(() => {
  router.replace.mockClear();
  router.refresh.mockClear();
  ok.mockClear();
});

const email = () => screen.getByLabelText("Email");
const password = () => screen.getByLabelText("Password");
const submit = () =>
  fireEvent.click(screen.getByRole("button", { name: "Log in" }));

function type(input: HTMLElement, value: string) {
  fireEvent.change(input, { target: { value } });
}

describe("LoginForm", () => {
  it("labels every field and uses the right input types", () => {
    render(<LoginForm onSubmit={ok} />);
    expect(email()).toHaveAttribute("type", "email");
    expect(email()).toHaveAttribute("autocomplete", "email");
    expect(password()).toHaveAttribute("type", "password");
    expect(password()).toHaveAttribute("autocomplete", "current-password");
  });

  it("shows no errors before the first submit", () => {
    render(<LoginForm onSubmit={ok} />);
    type(email(), "nope");
    expect(screen.queryByText(/valid email/)).not.toBeInTheDocument();
    expect(email()).not.toHaveAttribute("aria-invalid");
  });

  it("flags both fields on an empty submit and focuses the first", () => {
    render(<LoginForm onSubmit={ok} />);
    submit();
    expect(screen.getByText("Enter your email address.")).toBeInTheDocument();
    expect(screen.getByText("Enter your password.")).toBeInTheDocument();
    expect(email()).toHaveAttribute("aria-invalid", "true");
    expect(email()).toHaveFocus();
  });

  it("links each error to its field for screen readers", () => {
    render(<LoginForm onSubmit={ok} />);
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
    render(<LoginForm onSubmit={ok} />);
    type(email(), "ada@example.com");
    type(password(), "1234567");
    submit();
    expect(password()).toHaveFocus();
  });

  it("clears an error as soon as the field is fixed", () => {
    render(<LoginForm onSubmit={ok} />);
    submit();
    type(email(), "ada@example.com");
    expect(
      screen.queryByText("Enter your email address."),
    ).not.toBeInTheDocument();
    expect(email()).not.toHaveAttribute("aria-invalid");
    expect(screen.getByText("Enter your password.")).toBeInTheDocument();
  });

  it("goes to /courses after signing in", async () => {
    render(<LoginForm onSubmit={ok} />);
    type(email(), "ada@example.com");
    type(password(), "correct horse");
    await act(async () => submit());
    expect(router.replace).toHaveBeenCalledWith("/courses");
    expect(router.refresh).toHaveBeenCalled();
  });

  it("goes back to the page in ?next= after signing in", async () => {
    render(<LoginForm next="/courses/c1/map?x=1" onSubmit={ok} />);
    type(email(), "ada@example.com");
    type(password(), "correct horse");
    await act(async () => submit());
    expect(router.replace).toHaveBeenCalledWith("/courses/c1/map?x=1");
  });

  it.each(["https://evil.example/", "//evil.example", "/\\evil.example"])(
    "never follows ?next= off this site (%s)",
    async (next) => {
      render(<LoginForm next={next} onSubmit={ok} />);
      type(email(), "ada@example.com");
      type(password(), "correct horse");
      await act(async () => submit());
      expect(router.replace).toHaveBeenCalledWith("/courses");
    },
  );

  it("shows the failure message and stays on the page", async () => {
    const onSubmit = vi.fn(async () => RATE_LIMITED);
    render(<LoginForm onSubmit={onSubmit} />);
    type(email(), "ada@example.com");
    type(password(), "correct horse");
    await act(async () => submit());
    expect(screen.getByRole("status")).toHaveTextContent(RATE_LIMITED);
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("passes valid values to onSubmit, once, while the button is busy", async () => {
    let finish = () => {};
    const onSubmit = vi.fn(
      () =>
        new Promise<undefined>(
          (resolve) => (finish = () => resolve(undefined)),
        ),
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
    render(<LoginForm onSubmit={ok} />);
    type(email(), "ada@example.com");
    submit();
    expect(ok).not.toHaveBeenCalled();
  });

  it("shows a generic message, not the cause, when onSubmit fails", async () => {
    const onSubmit = vi.fn(async () => {
      throw new Error("db password=hunter2");
    });
    render(<LoginForm onSubmit={onSubmit} />);
    type(email(), "ada@example.com");
    type(password(), "correct horse");
    await act(async () => submit());
    expect(screen.getByRole("status")).toHaveTextContent(GENERIC_MESSAGE);
    expect(screen.queryByText(/hunter2/)).not.toBeInTheDocument();
  });

  it("links to sign up", () => {
    render(<LoginForm onSubmit={ok} />);
    expect(
      screen.getByRole("link", { name: "Create an account" }),
    ).toHaveAttribute("href", "/signup");
  });
});
