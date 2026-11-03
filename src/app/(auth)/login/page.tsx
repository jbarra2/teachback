import type { Metadata } from "next";
import { LoginForm } from "@/components/auth/login-form";
import { Card } from "@/components/ui";

export const metadata: Metadata = { title: "Log in · TeachBack" };

export default function LoginPage() {
  return (
    <Card className="mx-auto w-full max-w-sm">
      <h1 className="mb-4 text-2xl font-semibold">Log in</h1>
      <LoginForm />
    </Card>
  );
}
