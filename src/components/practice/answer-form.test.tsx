import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { AnswerForm } from "./answer-form";

const box = () => screen.getByLabelText("Explain it in your own words");
const submitButton = () =>
  screen.getByRole("button", { name: /Submit answer/ });

/** The form with its value held in state, as the session holds it. */
function Harness({
  onSubmit,
  pending = false,
  disabled = false,
  initial = "",
}: {
  onSubmit: (answer: string) => Promise<void>;
  pending?: boolean;
  disabled?: boolean;
  initial?: string;
}) {
  const [value, setValue] = useState(initial);
  return (
    <AnswerForm
      value={value}
      onChange={setValue}
      onSubmit={onSubmit}
      pending={pending}
      disabled={disabled}
    />
  );
}

/** A submit handler that stays pending until `finish` is called. */
function deferredSubmit() {
  let finish = () => {};
  const onSubmit = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  return { onSubmit, finish: () => finish() };
}

describe("AnswerForm", () => {
  describe("length limit", () => {
    it("caps the answer at 4000 characters", () => {
      render(<Harness onSubmit={vi.fn()} />);
      expect(box()).toHaveAttribute("maxlength", "4000");
    });

    it("counts characters as you type", () => {
      render(<Harness onSubmit={vi.fn()} />);
      expect(screen.getByText("0 / 4000")).toBeInTheDocument();
      fireEvent.change(box(), { target: { value: "Water follows solute." } });
      expect(screen.getByText("21 / 4000")).toBeInTheDocument();
    });

    it("marks the counter at the limit", () => {
      render(<Harness onSubmit={vi.fn()} initial={"a".repeat(4000)} />);
      expect(screen.getByText("4000 / 4000")).toHaveClass("text-danger");
    });
  });

  describe("submitting", () => {
    it("can't submit a blank answer", () => {
      const onSubmit = vi.fn(async () => {});
      render(<Harness onSubmit={onSubmit} initial="   " />);
      expect(submitButton()).toBeDisabled();
      fireEvent.keyDown(box(), { key: "Enter", ctrlKey: true });
      fireEvent.submit(screen.getByRole("form", { name: "Your answer" }));
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it("submits the answer with the button", () => {
      const onSubmit = vi.fn(async () => {});
      render(<Harness onSubmit={onSubmit} initial="Osmosis" />);
      fireEvent.click(submitButton());
      expect(onSubmit).toHaveBeenCalledExactlyOnceWith("Osmosis");
    });

    it.each([
      ["Ctrl+Enter", { ctrlKey: true }],
      ["Cmd+Enter", { metaKey: true }],
    ])("submits with %s", (_name, modifier) => {
      const onSubmit = vi.fn(async () => {});
      render(<Harness onSubmit={onSubmit} initial="Osmosis" />);
      fireEvent.keyDown(box(), { key: "Enter", ...modifier });
      expect(onSubmit).toHaveBeenCalledExactlyOnceWith("Osmosis");
    });

    it("doesn't submit on a plain Enter or Shift+Enter (new line)", () => {
      const onSubmit = vi.fn(async () => {});
      render(<Harness onSubmit={onSubmit} initial="Osmosis" />);
      fireEvent.keyDown(box(), { key: "Enter" });
      fireEvent.keyDown(box(), { key: "Enter", shiftKey: true });
      expect(onSubmit).not.toHaveBeenCalled();
    });
  });

  describe("double-submit prevention", () => {
    it("sends once for two quick clicks", async () => {
      const { onSubmit, finish } = deferredSubmit();
      render(<Harness onSubmit={onSubmit} initial="Osmosis" />);
      fireEvent.click(submitButton());
      fireEvent.click(submitButton());
      expect(onSubmit).toHaveBeenCalledOnce();
      await act(async () => finish());
    });

    it("sends once for a click and Ctrl+Enter together", async () => {
      const { onSubmit, finish } = deferredSubmit();
      render(<Harness onSubmit={onSubmit} initial="Osmosis" />);
      fireEvent.click(submitButton());
      fireEvent.keyDown(box(), { key: "Enter", ctrlKey: true });
      expect(onSubmit).toHaveBeenCalledOnce();
      await act(async () => finish());
    });

    it("can send again once the first request is done", async () => {
      const { onSubmit, finish } = deferredSubmit();
      render(<Harness onSubmit={onSubmit} initial="Osmosis" />);
      fireEvent.click(submitButton());
      await act(async () => finish());
      fireEvent.click(submitButton());
      expect(onSubmit).toHaveBeenCalledTimes(2);
    });

    it("disables the button and locks the box while pending", () => {
      const onSubmit = vi.fn(async () => {});
      render(<Harness onSubmit={onSubmit} pending initial="Osmosis" />);
      expect(submitButton()).toBeDisabled();
      expect(submitButton()).toHaveAttribute("aria-busy", "true");
      expect(box()).toHaveAttribute("readonly");
      fireEvent.keyDown(box(), { key: "Enter", ctrlKey: true });
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it("hides the button and ignores Ctrl+Enter once disabled", () => {
      const onSubmit = vi.fn(async () => {});
      render(<Harness onSubmit={onSubmit} disabled initial="Osmosis" />);
      expect(
        screen.queryByRole("button", { name: /Submit answer/ }),
      ).not.toBeInTheDocument();
      fireEvent.keyDown(box(), { key: "Enter", ctrlKey: true });
      expect(onSubmit).not.toHaveBeenCalled();
    });
  });
});
