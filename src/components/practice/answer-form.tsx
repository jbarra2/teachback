"use client";
// The answer box: PLAN §7's 4000-character limit with a counter, Ctrl/Cmd+Enter to submit, and
// one request at a time.
import { useRef, type FormEvent, type KeyboardEvent } from "react";
import { Button, Textarea } from "@/components/ui";
import { LIMITS } from "@/lib/schemas";

interface AnswerFormProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (answer: string) => Promise<void>;
  pending: boolean;
  /** Locks the box once feedback is shown. */
  disabled?: boolean;
}

export function AnswerForm({
  value,
  onChange,
  onSubmit,
  pending,
  disabled = false,
}: AnswerFormProps) {
  // `pending` arrives a render late, so two submits in the same tick would both see it false.
  const sending = useRef(false);
  const blank = value.trim() === "";

  async function submit() {
    if (sending.current || pending || disabled || blank) return;
    sending.current = true;
    try {
      await onSubmit(value);
    } finally {
      sending.current = false;
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submit();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void submit();
    }
  }

  return (
    <form
      aria-label="Your answer"
      onSubmit={handleSubmit}
      className="flex flex-col gap-3"
    >
      <Textarea
        id="practice-answer"
        name="answer"
        label="Explain it in your own words"
        hint="Press Ctrl+Enter (⌘+Enter on a Mac) to submit."
        maxLength={LIMITS.answer}
        showCount
        value={value}
        readOnly={pending || disabled}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
      />
      {!disabled && (
        <Button
          type="submit"
          loading={pending}
          disabled={blank}
          className="self-start"
        >
          Submit answer
        </Button>
      )}
    </form>
  );
}
