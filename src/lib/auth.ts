// The app's Better Auth instance, on PostgreSQL. Its models in prisma/schema.prisma come from Better
// Auth's CLI; src/lib/auth.test.ts fails when the config needs a table or field the schema lacks.
import { prismaAdapter } from "better-auth/adapters/prisma";
import { createAuth } from "@/lib/auth-config";
import { db } from "@/lib/db";

export { CLIENT_IP_HEADER } from "@/lib/auth-config";

export const auth = createAuth(
  // Better Auth runs each endpoint's writes in the adapter's transaction, which is a no-op unless
  // this is on. Sign-up writes the user, then its credential account: without it, a failure
  // between the two leaves a user with no password, and that address can never sign up again.
  prismaAdapter(db, { provider: "postgresql", transaction: true }),
);

export type Auth = typeof auth;
