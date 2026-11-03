// Prisma CLI config (PLAN §3). Migrations connect with DIRECT_URL; the app connects with
// DATABASE_URL through the pg adapter (src/lib/db.ts).
import { defineConfig } from "prisma/config";

// Prisma 7 doesn't read .env itself. Node's loader never overwrites a variable that's already set,
// so the shell and CI win over the file. A missing .env is fine: `prisma generate` (postinstall)
// needs no URL, and the commands that do say so.
try {
  process.loadEnvFile();
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: process.env.DIRECT_URL,
    // CI's drift check only (ci.yml): a scratch database Prisma wipes and rebuilds from the
    // migrations. Never point it at a database you want to keep.
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  },
});
