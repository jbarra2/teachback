"use client";
// Shared state for the login and signup forms: values, errors, and submit handling.
import { useRef, useState, type FormEvent } from "react";
import type { FieldErrors } from "./validation";

export const NOT_CONNECTED = "Sign-in isn't connected yet. It's coming soon.";
export const SUBMIT_FAILED = "Something went wrong. Please try again.";

export function useAuthForm<V extends Record<string, string>>({
  initial,
  validate,
  onSubmit,
}: {
  initial: V;
  validate: (values: V) => FieldErrors<Extract<keyof V, string>>;
  /** Wired in T06. Without it a valid submit only shows a notice. */
  onSubmit?: (values: V) => Promise<void> | void;
}) {
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<FieldErrors<Extract<keyof V, string>>>(
    {},
  );
  // Errors appear on the first submit, then update as the user types.
  const [submitted, setSubmitted] = useState(false);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string>();
  const formRef = useRef<HTMLFormElement>(null);

  function setValue(name: Extract<keyof V, string>, value: string) {
    const next = { ...values, [name]: value };
    setValues(next);
    if (submitted) setErrors(validate(next));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setSubmitted(true);
    setNotice(undefined);
    const found = validate(values);
    setErrors(found);
    const firstInvalid = Object.keys(values).find((name) => name in found);
    if (firstInvalid) {
      formRef.current
        ?.querySelector<HTMLElement>(`[name="${firstInvalid}"]`)
        ?.focus();
      return;
    }
    if (!onSubmit) {
      setNotice(NOT_CONNECTED);
      return;
    }
    setPending(true);
    try {
      await onSubmit(values);
    } catch {
      setNotice(SUBMIT_FAILED);
    } finally {
      setPending(false);
    }
  }

  return { values, errors, pending, notice, formRef, setValue, handleSubmit };
}
