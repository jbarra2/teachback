import { ESLint } from "eslint";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Lints snippets through the real eslint.config.mjs to prove each rule in docs/TESTING.md §5
// fires where it should and stays quiet where it shouldn't.
// Typed linting only works on files that exist, so the snippets are written into a sandbox
// (config + tsconfig copied in) under node_modules/.cache, which git, ESLint and tsc ignore.
const root = path.resolve(import.meta.dirname, "../..");

type Case = [name: string, file: string, code: string, rule: string];
type AllowedCase = [name: string, file: string, code: string];

// A typed `db` whose declaration doesn't itself name $queryRawUnsafe, so only the use is flagged.
const DB_DECL =
  "declare const db: Record<string, (s: string) => Promise<unknown>>;\n";

const BLOCKED: Case[] = [
  // Layering: no database access from pages, route handlers or components.
  [
    "db in a route handler",
    "src/app/api/courses/route.ts",
    `import { db } from "@/lib/db";\nexport const x = db;\n`,
    "no-restricted-imports",
  ],
  [
    "generated Prisma types in a component",
    "src/components/notes/list.tsx",
    `import type { Course } from "@/generated/prisma/client";\nexport type C = Course;\n`,
    "no-restricted-imports",
  ],
  [
    "db through a relative path",
    "src/app/(app)/courses/page.tsx",
    `import { db } from "../../../lib/db";\nexport const x = db;\n`,
    "no-restricted-imports",
  ],
  [
    "@prisma/client in a component",
    "src/components/map/graph.tsx",
    `import { PrismaClient } from "@prisma/client";\nexport const P = PrismaClient;\n`,
    "no-restricted-imports",
  ],
  [
    "re-exporting db from a route",
    "src/app/api/health/route.ts",
    `export { db } from "@/lib/db";\n`,
    "no-restricted-imports",
  ],
  [
    "dynamic import of db in a page",
    "src/app/(app)/map/page.tsx",
    `export const m = await import("@/lib/db");\n`,
    "no-restricted-syntax",
  ],
  // Layering: the Anthropic SDK only inside src/lib/ai/.
  [
    "SDK in a service",
    "src/lib/services/answer.ts",
    `import Anthropic from "@anthropic-ai/sdk";\nexport const c = new Anthropic();\n`,
    "no-restricted-imports",
  ],
  [
    "SDK subpath in a component",
    "src/components/practice/q.tsx",
    `import type { Message } from "@anthropic-ai/sdk/resources";\nexport type M = Message;\n`,
    "no-restricted-imports",
  ],
  [
    "SDK in a test helper",
    "tests/helpers/ai.ts",
    `import Anthropic from "@anthropic-ai/sdk";\nexport const c = new Anthropic();\n`,
    "no-restricted-imports",
  ],
  [
    "dynamic import of the SDK",
    "src/lib/services/questions.ts",
    `export const m = await import("@anthropic-ai/sdk");\n`,
    "no-restricted-syntax",
  ],
  // Raw SQL built from strings, in every form and every folder.
  [
    "$queryRawUnsafe call",
    "src/lib/services/raw1.ts",
    `${DB_DECL}export const r = db.$queryRawUnsafe("SELECT 1");\n`,
    "no-restricted-syntax",
  ],
  [
    "$executeRawUnsafe by string key",
    "src/lib/services/raw2.ts",
    `declare const db: Record<string, (s: string) => Promise<unknown>>;\nexport const r = db["$executeRawUnsafe"]("DELETE");\n`,
    "no-restricted-syntax",
  ],
  [
    "$queryRawUnsafe by template key",
    "src/lib/services/raw3.ts",
    'declare const db: Record<string, (s: string) => Promise<unknown>>;\nexport const r = db[`$queryRawUnsafe`]("SELECT 1");\n',
    "no-restricted-syntax",
  ],
  [
    "$queryRawUnsafe destructured",
    "src/lib/services/raw4.ts",
    `${DB_DECL}const { $queryRawUnsafe: q } = db;\nexport const r = q;\n`,
    "no-restricted-syntax",
  ],
  [
    "raw SQL inside src/lib/ai",
    "src/lib/ai/raw.ts",
    `${DB_DECL}export const r = db.$executeRawUnsafe("x");\n`,
    "no-restricted-syntax",
  ],
  [
    "raw SQL in a script",
    "scripts/fix-data.mjs",
    `export const run = (db) => db.$queryRawUnsafe("SELECT 1");\n`,
    "no-restricted-syntax",
  ],
  // Code execution and raw HTML.
  [
    "eval",
    "src/lib/services/ev.ts",
    `export const v = eval("1 + 1") as number;\n`,
    "no-eval",
  ],
  [
    "new Function",
    "src/lib/services/fn.ts",
    `export const f = new Function("return 1");\n`,
    "no-new-func",
  ],
  [
    "string timer in app code",
    "src/lib/services/timer.ts",
    `setTimeout("alert(1)", 1);\nexport {};\n`,
    "@typescript-eslint/no-implied-eval",
  ],
  [
    "string timer in a script",
    "scripts/timer.mjs",
    `setTimeout("alert(1)", 1);\n`,
    "no-implied-eval",
  ],
  [
    "dangerouslySetInnerHTML",
    "src/components/ui/html.tsx",
    `export const H = (p: { h: string }) => <div dangerouslySetInnerHTML={{ __html: p.h }} />;\n`,
    "react/no-danger",
  ],
  // Types and promises.
  [
    "explicit any",
    "src/lib/services/any.ts",
    `export const x: any = 1;\n`,
    "@typescript-eslint/no-explicit-any",
  ],
  [
    "floating promise",
    "src/lib/services/float.ts",
    `async function save(): Promise<void> {}\nsave();\nexport {};\n`,
    "@typescript-eslint/no-floating-promises",
  ],
  [
    "promise used as a condition",
    "src/lib/services/misused.ts",
    `declare const ready: Promise<boolean>;\nexport const x = ready ? 1 : 2;\n`,
    "@typescript-eslint/no-misused-promises",
  ],
  [
    "@ts-ignore",
    "src/lib/services/tsig.ts",
    `// @ts-ignore\nexport const x: number = "a";\n`,
    "@typescript-eslint/ban-ts-comment",
  ],
  // Logging goes through src/lib/log.ts.
  [
    "console in app code",
    "src/lib/services/log1.ts",
    `export const f = () => console.log("x");\n`,
    "no-console",
  ],
  [
    "console in tests",
    "tests/helpers/log.ts",
    `export const f = () => console.error("x");\n`,
    "no-console",
  ],
  [
    "console with an eslint-disable comment",
    "src/app/disable.ts",
    `// eslint-disable-next-line no-console\nconsole.log("x");\nexport {};\n`,
    "no-console",
  ],
  // The layering rules also cover JavaScript files (Next serves .js routes).
  [
    "db in a JS route handler",
    "src/app/api/legacy/route.js",
    `import { db } from "@/lib/db";\nexport const x = db;\n`,
    "no-restricted-imports",
  ],
  [
    "db in a JSX component",
    "src/components/ui/old.jsx",
    `import { db } from "@/lib/db";\nexport const Old = () => <p>{String(db)}</p>;\n`,
    "no-restricted-imports",
  ],
  [
    "SDK in a JS service",
    "src/lib/services/legacy.js",
    `import Anthropic from "@anthropic-ai/sdk";\nexport const c = new Anthropic();\n`,
    "no-restricted-imports",
  ],
  // Dynamic imports whose path the rules can't read.
  [
    "dynamic import of db through a template literal",
    "src/app/(app)/tpl/page.tsx",
    "export const m = await import(`@/lib/db`);\n",
    "no-restricted-syntax",
  ],
  [
    "dynamic import of a computed path",
    "src/lib/services/dyn.ts",
    `const p = "@/lib/db";\nexport const m = await import(p);\n`,
    "no-restricted-syntax",
  ],
  // More database access and raw SQL in pages and components.
  [
    "the pg driver in a route handler",
    "src/app/api/raw/route.ts",
    `import { Pool } from "pg";\nexport const P = Pool;\n`,
    "no-restricted-imports",
  ],
  [
    "raw SQL in a component",
    "src/components/ui/raw.tsx",
    `${DB_DECL}export const r = db.$queryRawUnsafe("SELECT 1");\n`,
    "no-restricted-syntax",
  ],
  [
    "db in an .mjs file under src/app",
    "src/app/(app)/helper.mjs",
    `import { db } from "@/lib/db";\nexport const x = db;\n`,
    "no-restricted-imports",
  ],
  [
    "db through require() in a JS route",
    "src/app/api/old/route.js",
    `const { db } = require("@/lib/db");\nexport const x = db;\n`,
    "@typescript-eslint/no-require-imports",
  ],
  [
    "a file inside a lib/db folder",
    "src/components/ui/pool.tsx",
    `import { pool } from "@/lib/db/pool";\nexport const P = pool;\n`,
    "no-restricted-imports",
  ],
  // Every JS/TS extension is linted (a .cjs file used to crash the whole lint run).
  [
    "db through require() in a .cjs file",
    "src/app/legacy.cjs",
    `const { db } = require("@/lib/db");\nmodule.exports = db;\n`,
    "@typescript-eslint/no-require-imports",
  ],
  [
    "db in an .mts file",
    "src/app/(app)/esm-helper.mts",
    `import { db } from "@/lib/db";\nexport const x = db;\n`,
    "no-restricted-imports",
  ],
  [
    "floating promise in an .mts file",
    "src/lib/services/esm.mts",
    `async function save(): Promise<void> {}\nsave();\nexport {};\n`,
    "@typescript-eslint/no-floating-promises",
  ],
  [
    "floating promise in a .cts file",
    "src/lib/services/legacy.cts",
    `async function save(): Promise<void> {}\nsave();\nexport {};\n`,
    "@typescript-eslint/no-floating-promises",
  ],
  [
    "the postgres driver in a component",
    "src/components/ui/sql.ts",
    `import postgres from "postgres";\nexport const sql = postgres;\n`,
    "no-restricted-imports",
  ],
  [
    "dangerouslySetInnerHTML in a .jsx component",
    "src/components/ui/legacy-html.jsx",
    `export const H = (p) => <div dangerouslySetInnerHTML={{ __html: p.h }} />;\n`,
    "react/no-danger",
  ],
  // The pages/components block replaces the earlier layering options, so it must repeat the SDK ban.
  [
    "dynamic import of the SDK in a component",
    "src/components/practice/ask.tsx",
    `export const m = await import("@anthropic-ai/sdk");\n`,
    "no-restricted-syntax",
  ],
  [
    "db in a .cts file in a component folder",
    "src/components/ui/db.cts",
    `import { db } from "@/lib/db";\nexport const x = db;\n`,
    "no-restricted-imports",
  ],
  [
    "dynamic import of db in a .cjs file",
    "src/app/dyn.cjs",
    `module.exports = import("@/lib/db");\n`,
    "no-restricted-syntax",
  ],
  // Typed rules cover components (.tsx): an async click handler is a misused promise.
  [
    "async function as an onClick handler",
    "src/components/ui/save-button.tsx",
    `async function save(): Promise<void> {}\nexport const SaveButton = () => <button onClick={save}>Save</button>;\n`,
    "@typescript-eslint/no-misused-promises",
  ],
  // Typed rules apply to tests too (an unawaited expect(...).rejects passes silently).
  [
    "floating promise in a test helper",
    "tests/helpers/float.ts",
    `async function save(): Promise<void> {}\nsave();\nexport {};\n`,
    "@typescript-eslint/no-floating-promises",
  ],
];

const ALLOWED: AllowedCase[] = [
  [
    "db in a service",
    "src/lib/services/courses.ts",
    `import { db } from "@/lib/db";\nexport const x = db;\n`,
  ],
  [
    "a page importing a service",
    "src/app/(app)/courses/[courseId]/page.tsx",
    `import { listCourses } from "@/lib/services/courses";\nexport const x = listCourses;\n`,
  ],
  [
    "the SDK in src/lib/ai",
    "src/lib/ai/provider.ts",
    `import Anthropic from "@anthropic-ai/sdk";\nexport const client = new Anthropic();\n`,
  ],
  [
    "the SDK in a JS file in src/lib/ai",
    "src/lib/ai/legacy.js",
    `import Anthropic from "@anthropic-ai/sdk";\nexport const client = new Anthropic();\n`,
  ],
  [
    "a plain-string dynamic import of a component",
    "src/app/(app)/courses/[courseId]/map/page.tsx",
    `export const Graph = await import("@/components/map/graph");\n`,
  ],
  [
    "tagged-template $queryRaw",
    "src/lib/services/map.ts",
    "declare const db: { $queryRaw(s: TemplateStringsArray, ...v: unknown[]): Promise<unknown> };\nexport const rows = db.$queryRaw`SELECT 1`;\n",
  ],
  [
    "console in the logger",
    "src/lib/log.ts",
    `export const log = (m: string) => {\n  console.log(m);\n};\n`,
  ],
  ["console in a script", "scripts/report.mjs", `console.log("done");\n`],
  [
    "console in a config file",
    "tool.config.mjs",
    `console.log("loaded");\nconst config = {};\nexport default config;\n`,
  ],
];

let box: string;
const results = new Map<string, ESLint.LintResult>();

beforeAll(async () => {
  const cache = path.join(root, "node_modules/.cache");
  mkdirSync(cache, { recursive: true });
  box = mkdtempSync(path.join(cache, "eslint-rules-"));
  copyFileSync(
    path.join(root, "eslint.config.mjs"),
    path.join(box, "eslint.config.mjs"),
  );
  copyFileSync(
    path.join(root, "tsconfig.json"),
    path.join(box, "tsconfig.json"),
  );
  const files = [...BLOCKED, ...ALLOWED].map(([, file, code]) => {
    const abs = path.join(box, file);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, code);
    return abs;
  });
  const eslint = new ESLint({ cwd: box });
  for (const r of await eslint.lintFiles(files))
    results.set(path.relative(box, r.filePath).replaceAll("\\", "/"), r);
}, 120_000);

afterAll(() => {
  if (box) rmSync(box, { recursive: true, force: true });
});

const errorsIn = (file: string) => {
  const r = results.get(file);
  if (!r) throw new Error(`${file} was not linted`);
  return r.messages.filter((m) => m.severity === 2).map((m) => m.ruleId);
};

describe("ESLint rules (docs/TESTING.md §5)", () => {
  it.each(BLOCKED)("blocks %s", (_name, file, _code, rule) => {
    expect(errorsIn(file)).toContain(rule);
  });

  it.each(ALLOWED)("allows %s", (_name, file) => {
    expect(results.get(file)?.messages).toEqual([]);
  });

  it("ignores eslint-disable comments and says so", () => {
    const messages = results.get("src/app/disable.ts")?.messages ?? [];
    expect(messages.some((m) => m.message.includes("noInlineConfig"))).toBe(
      true,
    );
  });
});
