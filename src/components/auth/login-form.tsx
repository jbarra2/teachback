"use client";
import Link from "next/link";
import { Button, Input } from "@/components/ui";
import { useAuthForm } from "./use-auth-form";
import { validateLogin, type LoginValues } from "./validation";

interface LoginFormProps {
  onSubmit?: (values: LoginValues) => Promise<void> | void;
}

export function LoginForm({ onSubmit }: LoginFormProps) {
  const { values, errors, pending, notice, formRef, setValue, handleSubmit } =
    useAuthForm<LoginValues>({
      initial: { email: "", password: "" },
      validate: validateLogin,
      onSubmit,
    });

  return (
    <form
      ref={formRef}
      noValidate
      aria-label="Log in"
      onSubmit={(event) => void handleSubmit(event)}
      className="flex flex-col gap-4"
    >
      <Input
        id="login-email"
        name="email"
        type="email"
        label="Email"
        autoComplete="email"
        value={values.email}
        error={errors.email}
        onChange={(event) => setValue("email", event.target.value)}
      />
      <Input
        id="login-password"
        name="password"
        type="password"
        label="Password"
        autoComplete="current-password"
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
        Log in
      </Button>
      <p className="text-sm text-muted">
        New here?{" "}
        <Link href="/signup" className="text-primary underline">
          Create an account
        </Link>
      </p>
    </form>
  );
}
