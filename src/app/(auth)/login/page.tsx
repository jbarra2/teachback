import type { Metadata } from "next";
import { LoginForm } from "@/components/auth/login-form";
import { Card } from "@/components/ui";

export const metadata: Metadata = { title: "Log in · TeachBack" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  // The proxy sends signed-out visitors here with ?next=<where they were going>. The form checks it.
  const { next } = await searchParams;
  return (
    <Card className="mx-auto w-full max-w-sm">
      <h1 className="mb-4 text-2xl font-semibold">Log in</h1>
      <LoginForm next={typeof next === "string" ? next : undefined} />
    </Card>
  );
}
