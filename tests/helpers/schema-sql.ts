// The SQL that prisma/schema.prisma creates on an empty database, for tests that check the schema
// without one (TESTING §4). `prisma migrate diff --from-empty` builds it from the schema file alone.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { repoRoot } from "./temp-dirs";

let cached: string | undefined;

/** CREATE statements for the whole schema. Runs the Prisma CLI once per test file. */
export function schemaSql(): string {
  if (cached !== undefined) return cached;
  // A folder with no .env, so prisma.config.ts loads nothing from a developer's own. The update
  // check is off: it reports to checkpoint.prisma.io, and its process held the folder open.
  const cwd = mkdtempSync(path.join(os.tmpdir(), "teachback-schema-sql-"));
  const env: NodeJS.ProcessEnv = { ...process.env, CHECKPOINT_DISABLE: "1" };
  delete env.DATABASE_URL;
  delete env.DIRECT_URL;
  delete env.SHADOW_DATABASE_URL;
  try {
    const res = spawnSync(
      process.execPath,
      [
        path.join(repoRoot, "node_modules/prisma/build/index.js"),
        "migrate",
        "diff",
        "--config",
        path.join(repoRoot, "prisma.config.ts"),
        "--from-empty",
        "--to-schema",
        path.join(repoRoot, "prisma/schema.prisma"),
        "--script",
      ],
      { cwd, env, encoding: "utf8" },
    );
    if (res.status !== 0)
      throw new Error(`prisma migrate diff failed:\n${res.stderr}`);
    // An empty result would let every "nothing missing" check pass.
    if (!/^CREATE TABLE "user"/m.test(res.stdout))
      throw new Error(`prisma migrate diff gave no tables:\n${res.stdout}`);
    cached = res.stdout;
    return cached;
  } finally {
    rmSync(cwd, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 200,
    });
  }
}

/** The column and constraint lines of one CREATE TABLE, or "" if the table isn't there. */
export function tableBody(sql: string, table: string): string {
  return (
    new RegExp(`CREATE TABLE "${table}" \\(([\\s\\S]*?)\\n\\);`).exec(
      sql,
    )?.[1] ?? ""
  );
}

/** The table's NOT NULL columns with no DEFAULT: what every insert must supply. */
export function requiredColumns(sql: string, table: string): string[] {
  return [...tableBody(sql, table).matchAll(/^\s*"(\w+)" ([^\n]*)$/gm)]
    .filter(([, , rest]) => / NOT NULL/.test(rest!) && !/ DEFAULT /.test(rest!))
    .map(([, column]) => column!);
}
