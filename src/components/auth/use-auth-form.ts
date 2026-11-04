"use client";
// Shared state for the login and signup forms: values, errors, and submit handling.
import { useRef, useState, type FormEvent } from "react";
import { GENERIC_MESSAGE } from "@/lib/api-client/errors";
import type { FieldErrors } from "./validation";

export function useAuthForm<V extends Record<string, string>>({
  initial,
  validate,
  onSubmit,
}: {
  initial: V;
  validate: (values: V) => FieldErrors<Extract<keyof V, string>>;
  /** Returns a message to show when it fails, or nothing when it succeeded. */
  onSubmit: (values: V) => Promise<string | undefined>;
}) {
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<FieldErrors<Extract<keyof V, string>>>(
    {},
  );
  // Errors appear on the first submit, then update as the user types.
  const [submitted, setSubmitted] = useState(false);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string>();
  // The state above updates on the next render; this blocks a second submit right away.
  const busy = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);

  function setValue(name: Extract<keyof V, string>, value: string) {
    const next = { ...values, [name]: value };
    setValues(next);
    if (submitted) setErrors(validate(next));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current) return;
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
    busy.current = true;
    setPending(true);
    let message: string | undefined;
    try {
      message = await onSubmit(values);
    } catch {
      message = GENERIC_MESSAGE;
    }
    // Signed in: the page is changing, so stay busy and a second click can't submit again.
    if (!message) return;
    setNotice(message);
    busy.current = false;
    setPending(false);
  }

  return { values, errors, pending, notice, formRef, setValue, handleSubmit };
}
