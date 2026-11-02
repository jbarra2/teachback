// Better Auth (PLAN §3), kept minimal: T06 adds the route handler, cookies and rate limiting.
// Its models in prisma/schema.prisma come from Better Auth's CLI; src/lib/auth.test.ts fails when
// this config needs a table or field the schema doesn't have yet.
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { readAuthSecret } from "@/lib/auth-secret";
import { db } from "@/lib/db";

export const auth = betterAuth({
  secret: readAuthSecret(),
  baseURL: process.env.BETTER_AUTH_URL,
  // Better Auth runs each endpoint's writes in the adapter's transaction, which is a no-op unless
  // this is on. Sign-up writes the user, then its credential account: without it, a failure
  // between the two leaves a user with no password, and that address can never sign up again.
  database: prismaAdapter(db, { provider: "postgresql", transaction: true }),
  // PLAN §1: email and password accounts. The limits match the sign-up form (T05).
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    maxPasswordLength: 128,
  },
  telemetry: { enabled: false },
});
