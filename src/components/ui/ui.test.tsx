import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Input,
  MASTERY_BADGE,
  MasteryBadge,
  Spinner,
  Textarea,
  cn,
} from ".";

describe("cn", () => {
  it("joins truthy class names", () => {
    expect(cn("a", false, undefined, "b", null, "")).toBe("a b");
  });
});

describe("Button", () => {
  it("is a non-submitting button by default", () => {
    render(<Button>Save</Button>);
    expect(screen.getByRole("button", { name: "Save" })).toHaveAttribute(
      "type",
      "button",
    );
  });

  it("calls onClick", () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Save</Button>);
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("is disabled and busy while loading, so it can't be pressed twice", () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Save
      </Button>,
    );
    const button = screen.getByRole("button", { name: /Save/ });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("status")).toHaveTextContent("Working…");
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("has a visible keyboard focus style", () => {
    render(<Button>Save</Button>);
    expect(screen.getByRole("button").className).toContain(
      "focus-visible:outline",
    );
  });
});

describe("Input", () => {
  it("links its label, hint and error", () => {
    render(
      <Input
        id="title"
        label="Title"
        hint="Up to 200 characters."
        error="Too long."
      />,
    );
    const input = screen.getByLabelText("Title");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription(
      "Up to 200 characters. Too long.",
    );
  });

  it("is plain when there's no hint or error", () => {
    render(<Input id="title" label="Title" />);
    const input = screen.getByLabelText("Title");
    expect(input).not.toHaveAttribute("aria-invalid");
    expect(input).not.toHaveAttribute("aria-describedby");
  });
});

describe("Textarea", () => {
  function Counted() {
    const [value, setValue] = useState("");
    return (
      <Textarea
        id="answer"
        label="Your answer"
        maxLength={10}
        showCount
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
    );
  }

  it("counts characters up to the limit", () => {
    render(<Counted />);
    const box = screen.getByLabelText("Your answer");
    expect(box).toHaveAttribute("maxlength", "10");
    expect(screen.getByText("0 / 10")).toBeInTheDocument();
    fireEvent.change(box, { target: { value: "hello" } });
    expect(screen.getByText("5 / 10")).toHaveClass("text-muted");
    fireEvent.change(box, { target: { value: "0123456789" } });
    expect(screen.getByText("10 / 10")).toHaveClass("text-danger");
  });

  it("shows no counter unless asked", () => {
    render(<Textarea id="notes" label="Notes" maxLength={10} />);
    expect(screen.queryByText(/\/ 10/)).not.toBeInTheDocument();
  });

  it("links its error", () => {
    render(<Textarea id="notes" label="Notes" error="Required." />);
    expect(screen.getByLabelText("Notes")).toHaveAccessibleDescription(
      "Required.",
    );
  });
});

describe("Badge", () => {
  it.each(Object.entries(MASTERY_BADGE))(
    "labels %s as %j",
    (state, { label }) => {
      render(<MasteryBadge state={state as keyof typeof MASTERY_BADGE} />);
      expect(screen.getByText(label)).toBeInTheDocument();
    },
  );

  it("reads MASTERED as 'Seems understood'", () => {
    expect(MASTERY_BADGE.MASTERED.label).toBe("Seems understood");
  });

  it("renders plain badges", () => {
    render(<Badge>New</Badge>);
    expect(screen.getByText("New")).toHaveClass("text-muted");
  });
});

describe("Spinner", () => {
  it("is a labelled status", () => {
    render(<Spinner label="Uploading…" />);
    expect(screen.getByRole("status")).toHaveTextContent("Uploading…");
  });
});

describe("Card", () => {
  it("renders its children", () => {
    render(<Card>Inside</Card>);
    expect(screen.getByText("Inside")).toBeInTheDocument();
  });
});

describe("EmptyState", () => {
  it("shows a title, description and action", () => {
    render(
      <EmptyState
        title="Nothing here"
        description="Add some notes."
        action={<a href="/x">Add</a>}
      />,
    );
    expect(
      screen.getByRole("heading", { name: "Nothing here" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Add some notes.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Add" })).toBeInTheDocument();
  });
});

describe("ErrorState", () => {
  it("is an alert with a default message", () => {
    render(<ErrorState />);
    expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("renders the message as text, not HTML", () => {
    render(<ErrorState message="<b>bold</b>" />);
    expect(screen.getByText("<b>bold</b>")).toBeInTheDocument();
    expect(document.querySelector("b")).toBeNull();
  });

  it("offers a retry", () => {
    const onRetry = vi.fn();
    render(<ErrorState onRetry={onRetry} />);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
