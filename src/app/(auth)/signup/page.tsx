import type { Metadata } from "next";
import { SignupForm } from "@/components/auth/signup-form";
import { Card } from "@/components/ui";

export const metadata: Metadata = { title: "Sign up · TeachBack" };

export default function SignupPage() {
  return (
    <Card className="mx-auto w-full max-w-sm">
      <h1 className="mb-4 text-2xl font-semibold">Create your account</h1>
      <SignupForm />
    </Card>
  );
}
