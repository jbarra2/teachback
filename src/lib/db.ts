// The one Prisma client (PLAN §3). Services import it; pages, routes and components can't (lint).
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

// Next reloads modules on every change in development, and each new client opens its own pool, so
// outside production the client is kept on globalThis and reused.
const cache = globalThis as typeof globalThis & { teachbackDb?: PrismaClient };

function createClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString)
    throw new Error(
      "DATABASE_URL is not set. Run `npm run setup`, which creates .env from .env.example.",
    );
  // pg-pool would wait forever for a free connection or a connect; fail the request instead.
  return new PrismaClient({
    adapter: new PrismaPg({
      connectionString,
      max: 10,
      connectionTimeoutMillis: 5_000,
    }),
  });
}

export const db = cache.teachbackDb ?? createClient();
if (process.env.NODE_ENV !== "production") cache.teachbackDb = db;
