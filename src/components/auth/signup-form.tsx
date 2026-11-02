"use client";
import Link from "next/link";
import { Button, Input } from "@/components/ui";
import { useAuthForm } from "./use-auth-form";
import {
  NAME_MAX,
  PASSWORD_MAX,
  PASSWORD_MIN,
  validateSignup,
  type SignupValues,
} from "./validation";

interface SignupFormProps {
  onSubmit?: (values: SignupValues) => Promise<void> | void;
}

export function SignupForm({ onSubmit }: SignupFormProps) {
  const { values, errors, pending, notice, formRef, setValue, handleSubmit } =
    useAuthForm<SignupValues>({
      initial: { name: "", email: "", password: "" },
      validate: validateSignup,
      onSubmit,
    });

  return (
    <form
      ref={formRef}
      noValidate
      aria-label="Sign up"
      onSubmit={(event) => void handleSubmit(event)}
      className="flex flex-col gap-4"
    >
      <Input
        id="signup-name"
        name="name"
        label="Name"
        autoComplete="name"
        maxLength={NAME_MAX}
        value={values.name}
        error={errors.name}
        onChange={(event) => setValue("name", event.target.value)}
      />
      <Input
        id="signup-email"
        name="email"
        type="email"
        label="Email"
        autoComplete="email"
        value={values.email}
        error={errors.email}
        onChange={(event) => setValue("email", event.target.value)}
      />
      <Input
        id="signup-password"
        name="password"
        type="password"
        label="Password"
        hint={`${PASSWORD_MIN}–${PASSWORD_MAX} characters.`}
        autoComplete="new-password"
        value={values.password}
        error={errors.password}
        onChange={(event) => setValue("password", event.target.value)}
      />
      {notice && (
        <p role="status" className="text-sm text-muted">
          {notice}
        </p>
      )}
      <Button type="submit" loading={pending}>
        Create account
      </Button>
      <p className="text-sm text-muted">
        Already have an account?{" "}
        <Link href="/login" className="text-primary underline">
          Log in
        </Link>
      </p>
    </form>
  );
}
