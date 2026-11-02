import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import AppError from "./error";

function renderError(error: unknown) {
  const retry = vi.fn();
  render(<AppError error={error} retry={retry} />);
  return retry;
}

describe("app error boundary", () => {
  it("shows a friendly message as an alert", () => {
    renderError(new Error("boom"));
    expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "This page couldn't load. Please try again.",
    );
  });

  it("never shows the thrown message or stack", () => {
    renderError(new Error("connect ECONNREFUSED db:5432 password=hunter2"));
    expect(document.body).not.toHaveTextContent(/ECONNREFUSED|hunter2/);
    expect(document.body).not.toHaveTextContent(/at .*\.tsx?:\d+/);
  });

  it.each([
    ["a string", "raw string thrown"],
    ["null", null],
    ["a plain object", { message: "object message" }],
  ])("handles %s thrown from a client component", (_label, thrown) => {
    renderError(thrown);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(
      /raw string thrown|object message/,
    );
  });

  it("shows a server error's digest as a reference", () => {
    renderError(Object.assign(new Error("hidden"), { digest: "3141592653" }));
    expect(screen.getByText("Reference: 3141592653")).toBeInTheDocument();
  });

  it("ignores a digest that isn't a short token", () => {
    renderError(
      Object.assign(new Error("x"), { digest: "<img src=x onerror=alert(1)>" }),
    );
    expect(screen.queryByText(/Reference/)).not.toBeInTheDocument();
  });

  it("retries when asked", () => {
    const retry = renderError(new Error("temporary"));
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledOnce();
  });
});
