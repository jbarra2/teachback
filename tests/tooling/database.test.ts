import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { load } from "js-yaml";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  Confidence,
  DocumentStatus,
  Prisma,
  QuestionKind,
  SourceType,
  Verdict,
} from "@/generated/prisma/browser";
import { LIMITS } from "@/lib/schemas";
import { loadSpec } from "../helpers/openapi-spec";
import { schemaSql, tableBody } from "../helpers/schema-sql";
import { repoRoot as root, tempDirs } from "../helpers/temp-dirs";

// T02: the local databases, Prisma's config, the schema (PLAN §6) and what the migrations create.
// No test here connects to a database (TESTING §4); T07's integration tests do.
// The prisma.config.ts tests each start a Node process, which can pass the 5 s default when busy.
vi.setConfig({ testTimeout: 30_000 });
const read = (file: string) => readFileSync(path.join(root, file), "utf8");
const dirs = tempDirs("teachback-database-");
afterAll(() => dirs.removeAll());

/**
 * This process's environment without database URLs, so nothing here can reach a real database,
 * and with Prisma's update check off: the CLI otherwise forks a process that reports to
 * checkpoint.prisma.io (unit tests use no network), and under Vitest that kept the working folder
 * open until the run ended.
 */
function envWithoutDatabases(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, CHECKPOINT_DISABLE: "1" };
  delete env.DATABASE_URL;
  delete env.DIRECT_URL;
  delete env.SHADOW_DATABASE_URL;
  return env;
}

describe("docker-compose.yml (PLAN §3)", () => {
  type Service = {
    image?: string;
    ports?: string[];
    volumes?: string[];
    tmpfs?: string[];
    environment?: Record<string, string>;
    healthcheck?: { test?: string[] };
    network_mode?: string;
  };
  const compose = load(read("docker-compose.yml")) as {
    services: Record<string, Service>;
    volumes?: Record<string, unknown>;
  };
  const { db, "db-test": dbTest } = compose.services;

  it("runs exactly the dev and test databases, on PostgreSQL 17", () => {
    expect(Object.keys(compose.services).sort()).toEqual(["db", "db-test"]);
    expect(db?.image).toBe("postgres:17");
    expect(dbTest?.image).toBe("postgres:17");
  });

  // A bare "5433:5432" would publish the database, with its fixed password, on every network the
  // laptop joins.
  it("binds both to 127.0.0.1 only", () => {
    expect(db?.ports).toEqual(["127.0.0.1:5433:5432"]);
    expect(dbTest?.ports).toEqual(["127.0.0.1:5434:5432"]);
    expect(db?.network_mode).toBeUndefined();
    expect(dbTest?.network_mode).toBeUndefined();
  });

  it("keeps dev data in a volume and the test database in memory (tmpfs)", () => {
    expect(db?.volumes).toEqual(["pgdata:/var/lib/postgresql/data"]);
    expect(Object.keys(compose.volumes ?? {})).toEqual(["pgdata"]);
    expect(dbTest?.tmpfs).toEqual(["/var/lib/postgresql/data"]);
    expect(dbTest?.volumes).toBeUndefined();
  });

  it("names the databases the env files use, with health checks", () => {
    expect(db?.environment?.POSTGRES_DB).toBe("teachback");
    expect(dbTest?.environment?.POSTGRES_DB).toBe("teachback_test");
    for (const service of [db, dbTest])
      expect(service?.healthcheck?.test?.join(" ")).toContain("pg_isready");
  });
});

describe("env files (PLAN §10)", () => {
  const value = (file: string, name: string) =>
    new RegExp(`^${name}=(.*)$`, "m").exec(read(file))?.[1];

  // T07's test setup refuses a database whose name doesn't end in _test, so this name matters.
  it.each([
    [".env.example", "127.0.0.1:5433/teachback"],
    [".env.test", "127.0.0.1:5434/teachback_test"],
  ])("%s points both URLs at the local database (%s)", (file, target) => {
    for (const name of ["DATABASE_URL", "DIRECT_URL"])
      expect(value(file, name)).toBe(
        `postgresql://teachback:teachback@${target}`,
      );
  });

  // prisma.config.ts loads .env, so once .env exists this turns off the Prisma CLI's update check
  // and usage report for every db:* script and postinstall (setup writes .env before it installs).
  // A clone that runs `npm install` before setup still makes that first call.
  it.each([".env.example", ".env.test"])(
    "%s turns off the Prisma CLI's checkpoint call",
    (file) => {
      expect(value(file, "CHECKPOINT_DISABLE")).toBe("1");
    },
  );

  // Prisma wipes the shadow database, so no developer gets one from the templates.
  it.each([".env.example", ".env.test"])(
    "%s doesn't set SHADOW_DATABASE_URL",
    (file) => {
      expect(read(file)).not.toMatch(/^\s*SHADOW_DATABASE_URL\s*=/m);
    },
  );
});

describe("prisma.config.ts", () => {
  const configUrl = pathToFileURL(path.join(root, "prisma.config.ts")).href;

  /** Loads the config the way the Prisma CLI does: from a folder that may hold a .env. */
  function loadConfig(
    dotEnv: string | null,
    env: Record<string, string> = {},
  ): {
    status: number | null;
    stderr: string;
    config?: {
      schema?: string;
      migrations?: { path?: string; seed?: string };
      datasource?: { url?: string; shadowDatabaseUrl?: string };
    };
  } {
    const dir = dirs.make();
    if (dotEnv !== null) writeFileSync(path.join(dir, ".env"), dotEnv);
    const clean = envWithoutDatabases();
    const res = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        "const { default: c } = await import(process.env.CONFIG_URL); console.log(JSON.stringify(c));",
      ],
      {
        cwd: dir,
        encoding: "utf8",
        env: { ...clean, ...env, CONFIG_URL: configUrl },
      },
    );
    const lastLine = res.stdout.trim().split("\n").pop();
    return {
      status: res.status,
      stderr: res.stderr,
      config: res.status === 0 && lastLine ? JSON.parse(lastLine) : undefined,
    };
  }

  // Neon (stretch) needs the direct, unpooled URL for migrations; the app uses DATABASE_URL.
  it("runs migrations against DIRECT_URL from .env, not DATABASE_URL", () => {
    const { status, config } = loadConfig(
      "DATABASE_URL=postgresql://pooled.invalid/app\nDIRECT_URL=postgresql://direct.invalid/app\n",
    );
    expect(status).toBe(0);
    expect(config?.datasource?.url).toBe("postgresql://direct.invalid/app");
  });

  // CI's drift check sets SHADOW_DATABASE_URL; nothing else does, and Prisma wipes that database.
  it("takes the shadow database only from SHADOW_DATABASE_URL", () => {
    const set = loadConfig("DIRECT_URL=postgresql://direct.invalid/app\n", {
      SHADOW_DATABASE_URL: "postgresql://shadow.invalid/scratch",
    });
    expect(set.config?.datasource?.shadowDatabaseUrl).toBe(
      "postgresql://shadow.invalid/scratch",
    );
    // Both other URLs present, in .env and the shell, so a fallback to either would show.
    const unset = loadConfig(
      "DIRECT_URL=postgresql://direct.invalid/app\nDATABASE_URL=postgresql://pooled.invalid/app\n",
      { DATABASE_URL: "postgresql://pooled-env.invalid/app" },
    );
    expect(unset.status).toBe(0);
    expect(unset.config?.datasource?.shadowDatabaseUrl).toBeUndefined();
  });

  it("lets a variable that's already set win over .env", () => {
    const { config } = loadConfig(
      "DIRECT_URL=postgresql://from-file.invalid/x\n",
      {
        DIRECT_URL: "postgresql://from-env.invalid/x",
      },
    );
    expect(config?.datasource?.url).toBe("postgresql://from-env.invalid/x");
  });

  // A pooled URL can't run migrations (Neon), so DATABASE_URL is never the fallback.
  it("doesn't fall back to DATABASE_URL when DIRECT_URL is missing", () => {
    const { status, config } = loadConfig(
      "DATABASE_URL=postgresql://pooled.invalid/app\n",
    );
    expect(status).toBe(0);
    expect(config?.datasource?.url).toBeUndefined();
  });

  // postinstall runs `prisma generate`, which needs no database, on clones that have no .env yet.
  it("loads with no .env and no DIRECT_URL", () => {
    const { status, config } = loadConfig(null);
    expect(status).toBe(0);
    expect(config?.datasource?.url).toBeUndefined();
  });

  // A .env that exists but can't be read must stop the CLI: carrying on would migrate whatever
  // database the shell happens to point at. (A folder named .env stands in for an unreadable file.)
  it("stops on a .env it can't read, rather than carrying on without it", () => {
    const dir = dirs.make();
    mkdirSync(path.join(dir, ".env"));
    const res = spawnSync(
      process.execPath,
      ["--input-type=module", "-e", "await import(process.env.CONFIG_URL);"],
      {
        cwd: dir,
        encoding: "utf8",
        env: { ...envWithoutDatabases(), CONFIG_URL: configUrl },
      },
    );
    expect(res.status).not.toBe(0);
    // Windows reports a folder as ERR_INVALID_ARG_TYPE, Linux and macOS as EISDIR.
    expect(res.stderr).toMatch(/ERR_INVALID_ARG_TYPE|EISDIR/);
    expect(res.stderr).toMatch(/loadEnvFile|\.env/);
  });

  // The same stop through the Prisma CLI's own config loader, not just a plain import.
  it("makes the Prisma CLI stop on a .env it can't read", () => {
    const dir = dirs.make();
    mkdirSync(path.join(dir, ".env"));
    const res = spawnSync(
      process.execPath,
      [
        path.join(root, "node_modules/prisma/build/index.js"),
        "validate",
        "--config",
        path.join(root, "prisma.config.ts"),
        "--schema",
        path.join(root, "prisma/schema.prisma"),
      ],
      { cwd: dir, encoding: "utf8", env: envWithoutDatabases() },
    );
    expect(res.status).not.toBe(0);
    expect(`${res.stdout}${res.stderr}`).toMatch(
      /ERR_INVALID_ARG_TYPE|EISDIR|\.env/,
    );
  });

  it("points at the schema, the migrations and the seed script", () => {
    const { config } = loadConfig(null);
    expect(config?.schema).toBe("prisma/schema.prisma");
    expect(config?.migrations).toEqual({
      path: "prisma/migrations",
      seed: "tsx prisma/seed.ts",
    });
  });
});

describe("prisma/schema.prisma", () => {
  const schema = read("prisma/schema.prisma");
  const block = (kind: string, name: string) =>
    new RegExp(`^${kind} ${name} \\{\\n([\\s\\S]*?)^\\}`, "m").exec(
      schema,
    )?.[1] ?? "";

  it("generates the Prisma 7 client into src/generated/prisma (PLAN §3)", () => {
    const generator = block("generator", "client");
    expect(generator).toMatch(/^\s*provider\s*=\s*"prisma-client"$/m);
    expect(generator).toMatch(
      /^\s*output\s*=\s*"\.\.\/src\/generated\/prisma"$/m,
    );
  });

  // Prisma 7 takes the URL from prisma.config.ts (DIRECT_URL) and the adapter (DATABASE_URL).
  it("is PostgreSQL, with no URL in the schema", () => {
    const datasource = block("datasource", "db");
    expect(datasource).toMatch(/^\s*provider\s*=\s*"postgresql"$/m);
    expect(datasource).not.toMatch(/\burl\b/);
  });

  it("gives User its courses, attempts and mastery (PLAN §6)", () => {
    const user = block("model", "User");
    expect(user).toMatch(/^\s*courses\s+Course\[\]$/m);
    expect(user).toMatch(/^\s*attempts\s+Attempt\[\]$/m);
    expect(user).toMatch(/^\s*mastery\s+Mastery\[\]$/m);
  });

  // The API refuses any id that isn't a cuid (^c[a-z0-9]{24}$, src/lib/schemas/common.ts). The
  // generator lives in the client, not the SQL, so the drift check wouldn't see uuid() either.
  it.each([
    "Course",
    "Document",
    "Chunk",
    "Concept",
    "ConceptEdge",
    "Question",
    "Attempt",
  ])("gives %s a cuid() id", (model) => {
    expect(block("model", model)).toMatch(
      /^\s*id\s+String\s+@id @default\(cuid\(\)\)$/m,
    );
  });
});

describe("the generated client matches PLAN §6", () => {
  // The checks below read the generated client, which only postinstall, db:generate and db:update
  // rebuild. A schema edit without one of them would be tested against the old schema.
  it("was generated from the current prisma/schema.prisma (else run `npm run db:generate`)", () => {
    const client = read("src/generated/prisma/internal/class.ts");
    const literal = /"inlineSchema": ("(?:[^"\\]|\\.)*")/.exec(client)?.[1];
    expect(literal, "no inlineSchema in the generated client").toBeDefined();
    const generatedFrom = JSON.parse(literal!) as string;
    const normalize = (text: string) => text.replace(/\r\n/g, "\n").trim();
    expect(
      normalize(generatedFrom) === normalize(read("prisma/schema.prisma")),
      "src/generated/prisma is out of date: run `npm run db:generate`",
    ).toBe(true);
  });

  const fieldsOf = (model: string) =>
    Object.keys(
      (Prisma as unknown as Record<string, Record<string, string>>)[
        `${model}ScalarFieldEnum`
      ] ?? {},
    ).sort();

  it("has the auth models and every domain model, and nothing else", () => {
    expect(Object.keys(Prisma.ModelName).sort()).toEqual(
      [
        "Account",
        "ApiRateLimit",
        "Attempt",
        "Chunk",
        "Concept",
        "ConceptChunk",
        "ConceptEdge",
        "Course",
        "Document",
        "Mastery",
        "Question",
        // Better Auth's rate limit counters (T06), separate from the app's ApiRateLimit (T14).
        "RateLimit",
        "Session",
        "User",
        "Verification",
      ].sort(),
    );
  });

  it.each([
    ["Course", ["id", "userId", "name", "createdAt"]],
    [
      "Document",
      [
        "id",
        "courseId",
        "title",
        "sourceType",
        "rawText",
        "status",
        "error",
        "createdAt",
        "updatedAt",
      ],
    ],
    ["Chunk", ["id", "documentId", "order", "text", "refLabel"]],
    ["Concept", ["id", "courseId", "name", "nameKey", "summary", "createdAt"]],
    ["ConceptChunk", ["conceptId", "chunkId"]],
    ["ConceptEdge", ["id", "fromId", "toId"]],
    [
      "Question",
      ["id", "conceptId", "text", "kind", "sourceChunkIds", "createdAt"],
    ],
    [
      "Attempt",
      [
        "id",
        "userId",
        "questionId",
        "answer",
        "verdict",
        "confidence",
        "feedback",
        "createdAt",
      ],
    ],
    ["Mastery", ["userId", "conceptId", "score", "attempts", "lastSeenAt"]],
    ["ApiRateLimit", ["key", "windowStart", "count"]],
  ])("%s has exactly its PLAN §6 fields", (model, fields) => {
    expect(fieldsOf(model)).toEqual([...fields].sort());
  });

  it("has SourceType's three kinds", () => {
    expect(Object.values(SourceType)).toEqual(["TEXT", "MARKDOWN", "PDF"]);
  });

  // The API returns these values as they're stored, so they must be the contract's.
  it.each([
    ["DocumentStatus", DocumentStatus],
    ["QuestionKind", QuestionKind],
    ["Verdict", Verdict],
    ["Confidence", Confidence],
  ])("%s has exactly the values in openapi.yaml", (name, values) => {
    const spec = loadSpec() as {
      components: { schemas: Record<string, { enum?: string[] }> };
    };
    expect(Object.values(values)).toEqual(spec.components.schemas[name]?.enum);
  });
});

describe("prisma/migrations", () => {
  const dir = path.join(root, "prisma/migrations");
  const migrations = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  it("has at least the first migration, each with its SQL, for PostgreSQL", () => {
    expect(migrations.length).toBeGreaterThan(0);
    for (const name of migrations)
      expect(existsSync(path.join(dir, name, "migration.sql")), name).toBe(
        true,
      );
    expect(readFileSync(path.join(dir, "migration_lock.toml"), "utf8")).toMatch(
      /^provider = "postgresql"$/m,
    );
  });
});

// What schema.prisma creates on an empty database, as SQL. `prisma migrate diff --from-empty` builds
// it from the schema alone, with no database, so these checks follow the current schema, not the
// first migration's text, and stay true after later migrations. That the migrations build this same
// database needs a real one to check (the drift check).
describe("the database schema.prisma describes", () => {
  let sql = "";
  beforeAll(() => {
    sql = schemaSql();
  }, 60_000);
  const table = (name: string) => tableBody(sql, name);

  // PostgreSQL counts varchar length in characters, as the API's text() does (src/lib/schemas).
  it.each([
    ["Course", "name", LIMITS.courseName],
    ["Document", "title", LIMITS.documentTitle],
    ["Attempt", "answer", LIMITS.answer],
  ])("caps %s.%s at the API limit (%i)", (model, column, limit) => {
    expect(table(model)).toMatch(
      new RegExp(`"${column}" VARCHAR\\(${limit}\\) NOT NULL`),
    );
  });

  // Every column's type, NULL rule and default, as PLAN §6 defines them. Documents start QUEUED,
  // `error` and `lastSeenAt` are the only optional fields, and the counters start at 0.
  const TIMESTAMP = "TIMESTAMP(3) NOT NULL";
  const CREATED = `"createdAt" ${TIMESTAMP} DEFAULT CURRENT_TIMESTAMP`;
  it.each<[string, string[]]>([
    [
      "Course",
      [
        `"id" TEXT NOT NULL`,
        `"userId" TEXT NOT NULL`,
        `"name" VARCHAR(${LIMITS.courseName}) NOT NULL`,
        CREATED,
      ],
    ],
    [
      "Document",
      [
        `"id" TEXT NOT NULL`,
        `"courseId" TEXT NOT NULL`,
        `"title" VARCHAR(${LIMITS.documentTitle}) NOT NULL`,
        `"sourceType" "SourceType" NOT NULL`,
        `"rawText" TEXT NOT NULL`,
        `"status" "DocumentStatus" NOT NULL DEFAULT 'QUEUED'`,
        `"error" TEXT`,
        CREATED,
        `"updatedAt" ${TIMESTAMP}`,
      ],
    ],
    [
      "Chunk",
      [
        `"id" TEXT NOT NULL`,
        `"documentId" TEXT NOT NULL`,
        `"order" INTEGER NOT NULL`,
        `"text" TEXT NOT NULL`,
        `"refLabel" TEXT NOT NULL`,
      ],
    ],
    [
      "Concept",
      [
        `"id" TEXT NOT NULL`,
        `"courseId" TEXT NOT NULL`,
        `"name" TEXT NOT NULL`,
        `"nameKey" TEXT NOT NULL`,
        `"summary" TEXT NOT NULL`,
        CREATED,
      ],
    ],
    ["ConceptChunk", [`"conceptId" TEXT NOT NULL`, `"chunkId" TEXT NOT NULL`]],
    [
      "ConceptEdge",
      [`"id" TEXT NOT NULL`, `"fromId" TEXT NOT NULL`, `"toId" TEXT NOT NULL`],
    ],
    [
      "Question",
      [
        `"id" TEXT NOT NULL`,
        `"conceptId" TEXT NOT NULL`,
        `"text" TEXT NOT NULL`,
        `"kind" "QuestionKind" NOT NULL`,
        `"sourceChunkIds" TEXT[]`,
        CREATED,
      ],
    ],
    [
      "Attempt",
      [
        `"id" TEXT NOT NULL`,
        `"userId" TEXT NOT NULL`,
        `"questionId" TEXT NOT NULL`,
        `"answer" VARCHAR(${LIMITS.answer}) NOT NULL`,
        `"verdict" "Verdict" NOT NULL`,
        `"confidence" "Confidence" NOT NULL`,
        `"feedback" JSONB NOT NULL`,
        CREATED,
      ],
    ],
    [
      "Mastery",
      [
        `"userId" TEXT NOT NULL`,
        `"conceptId" TEXT NOT NULL`,
        `"score" DOUBLE PRECISION NOT NULL DEFAULT 0`,
        `"attempts" INTEGER NOT NULL DEFAULT 0`,
        `"lastSeenAt" TIMESTAMP(3)`,
      ],
    ],
    [
      "ApiRateLimit",
      [
        `"key" TEXT NOT NULL`,
        `"windowStart" ${TIMESTAMP}`,
        `"count" INTEGER NOT NULL DEFAULT 0`,
      ],
    ],
  ])("%s has exactly its PLAN §6 columns", (model, columns) => {
    const lines = table(model)
      .split("\n")
      .map((line) => line.trim().replace(/,$/, ""))
      .filter((line) => line.startsWith('"'));
    expect(lines).toEqual(columns);
  });

  // Deleting a user or a course must take everything under it, so nothing is left orphaned.
  it("cascades every foreign key on delete", () => {
    const keys = [...sql.matchAll(/FOREIGN KEY \("(\w+)"\)[^;]*/g)].map(
      (m) => m[0],
    );
    expect(keys.length).toBe(15);
    for (const key of keys) expect(key).toMatch(/ON DELETE CASCADE/);
  });

  it.each([
    ["Course", "userId", "user"],
    ["Document", "courseId", "Course"],
    ["Chunk", "documentId", "Document"],
    ["Concept", "courseId", "Course"],
    ["ConceptChunk", "conceptId", "Concept"],
    ["ConceptChunk", "chunkId", "Chunk"],
    ["ConceptEdge", "fromId", "Concept"],
    ["ConceptEdge", "toId", "Concept"],
    ["Question", "conceptId", "Concept"],
    ["Attempt", "userId", "user"],
    ["Attempt", "questionId", "Question"],
    ["Mastery", "userId", "user"],
    ["Mastery", "conceptId", "Concept"],
    ["session", "userId", "user"],
    ["account", "userId", "user"],
  ])("%s.%s references %s and cascades", (model, column, target) => {
    expect(sql).toMatch(
      new RegExp(
        `ALTER TABLE "${model}" ADD CONSTRAINT "\\w+" FOREIGN KEY \\("${column}"\\) REFERENCES "${target}"\\("id"\\) ON DELETE CASCADE`,
      ),
    );
  });

  it.each([
    ["Concept", ["courseId", "nameKey"]],
    ["Chunk", ["documentId", "order"]],
    ["ConceptEdge", ["fromId", "toId"]],
    ["user", ["email"]],
    ["session", ["token"]],
    // Better Auth's database rate limiter relies on it: two first requests at once must collide.
    ["rateLimit", ["key"]],
  ])("%s is unique on (%s)", (model, columns) => {
    const list = columns.map((c) => `"${c}"`).join(", ");
    expect(sql).toMatch(
      new RegExp(`CREATE UNIQUE INDEX "\\w+" ON "${model}"\\(${list}\\);`),
    );
  });

  it.each([
    ["ConceptChunk", ["conceptId", "chunkId"]],
    ["Mastery", ["userId", "conceptId"]],
    ["ApiRateLimit", ["key", "windowStart"]],
  ])("%s's primary key is (%s)", (model, columns) => {
    const list = columns.map((c) => `"${c}"`).join(",");
    expect(table(model)).toMatch(
      new RegExp(`CONSTRAINT "\\w+" PRIMARY KEY \\(${list}\\)`),
    );
  });

  it.each([
    ["Course", ["userId"]],
    ["Document", ["courseId"]],
    ["Attempt", ["userId", "createdAt"]],
  ])("indexes %s on (%s)", (model, columns) => {
    const list = columns.map((c) => `"${c}"`).join(", ");
    expect(sql).toMatch(
      new RegExp(`CREATE INDEX "\\w+" ON "${model}"\\(${list}\\);`),
    );
  });
});
