import { spawnSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, describe, expect, it, vi } from "vitest";
import { SPEC_PATH } from "../helpers/openapi-spec";
import { cleanEnv, repoRoot, tempDirs } from "../helpers/temp-dirs";

// scripts/api-types.mjs (api:types, api:types:check) and scripts/api-lint.mjs (api:lint), run as
// npm runs them: plain Node, from the repo root.
vi.setConfig({ testTimeout: 60_000 });

const dirs = tempDirs("teachback-api-");
afterAll(() => dirs.removeAll());

const run = (script: string, args: string[], env = process.env) =>
  spawnSync(
    process.execPath,
    [path.join(repoRoot, "scripts", script), ...args],
    {
      cwd: repoRoot,
      encoding: "utf8",
      env,
    },
  );

describe("api:types and api:types:check (scripts/api-types.mjs)", () => {
  const dir = dirs.make();
  const out = path.join(dir, "schema.d.ts");
  const types = (...extra: string[]) =>
    run("api-types.mjs", ["--spec", SPEC_PATH, "--out", out, ...extra]);

  it("the committed client types match openapi.yaml", () => {
    // On a copy, so a broken --check can't rewrite the committed file.
    const copy = path.join(dirs.make(), "schema.d.ts");
    writeFileSync(
      copy,
      readFileSync(path.join(repoRoot, "src/lib/api-client/schema.d.ts")),
    );
    const res = run("api-types.mjs", [
      "--spec",
      SPEC_PATH,
      "--out",
      copy,
      "--check",
    ]);
    expect(res.stderr).toBe("");
    expect(res.stdout).toContain("matches openapi.yaml");
    expect(res.status).toBe(0);
  });

  it("accepts a current file checked out with Windows line endings", () => {
    expect(types().status).toBe(0);
    writeFileSync(out, readFileSync(out, "utf8").replace(/\n/g, "\r\n"));
    const check = types("--check");
    expect(check.stdout).toContain("matches openapi.yaml");
    expect(check.status).toBe(0);
  });

  it("writes the types, then the check passes", () => {
    expect(types().status).toBe(0);
    expect(readFileSync(out, "utf8")).toContain("export interface paths");
    const check = types("--check");
    expect(check.status).toBe(0);
    expect(check.stdout).toContain("matches openapi.yaml");
  });

  it("fails the check when the file is stale", () => {
    expect(types().status).toBe(0);
    writeFileSync(
      out,
      readFileSync(out, "utf8").replace("conceptCount", "conceptTotal"),
    );
    const check = types("--check");
    expect(check.status).toBe(1);
    expect(check.stderr).toContain("doesn't match openapi.yaml");
  });

  it("fails the check when the file is missing (an untracked file can't pass in CI)", () => {
    rmSync(out, { force: true });
    const check = types("--check");
    expect(check.status).toBe(1);
    expect(check.stderr).toContain("is missing");
  });

  it("fails the check when the spec changed and the types weren't regenerated", () => {
    expect(types().status).toBe(0);
    const spec = path.join(dir, "openapi.yaml");
    writeFileSync(
      spec,
      readFileSync(SPEC_PATH, "utf8").replace(
        "conceptCount: { type: integer, minimum: 0 }",
        "conceptCount: { type: integer, minimum: 0 }\n        pageCount: { type: integer }",
      ),
    );
    const check = run("api-types.mjs", [
      "--spec",
      spec,
      "--out",
      out,
      "--check",
    ]);
    expect(check.status).toBe(1);
    expect(check.stderr).toContain("doesn't match openapi.yaml");
  });

  it("types upload files as Blob, not string", () => {
    expect(
      readFileSync(
        path.join(repoRoot, "src/lib/api-client/schema.d.ts"),
        "utf8",
      ),
    ).toMatch(/^\s+file\?: Blob;$/m);
  });
});

describe("api:lint (scripts/api-lint.mjs)", () => {
  it("passes the contract", () => {
    const res = run("api-lint.mjs", []);
    expect(res.status).toBe(0);
  });

  it("fails a spec that breaks a rule, with Redocly's exit code", () => {
    const dir = dirs.make();
    const broken = path.join(dir, "openapi.yaml");
    // An example that doesn't match its schema (no-invalid-media-type-examples).
    writeFileSync(
      broken,
      readFileSync(SPEC_PATH, "utf8").replace(
        "example: { status: ok, db: up }",
        "example: { status: fine, db: up }",
      ),
    );
    const res = run("api-lint.mjs", [broken]);
    expect(res.status).not.toBe(0);
    expect(res.stdout + res.stderr).toMatch(/no-invalid-media-type-examples/);
  });

  it("starts Redocly with no update check (it aborts on Windows) and no telemetry", () => {
    // A preload records the environment of every Node process the script starts, so this checks
    // what Redocly itself sees. (If the settings regressed, that run would reach the npm registry.)
    const dir = dirs.make();
    const log = path.join(dir, "env.jsonl");
    const preload = path.join(dir, "record-env.mjs");
    writeFileSync(
      preload,
      [
        'import { appendFileSync } from "node:fs";',
        "appendFileSync(process.env.TEACHBACK_ENV_LOG, JSON.stringify({",
        '  script: process.argv[1] ?? "",',
        "  args: process.argv.slice(2),",
        "  suppress: process.env.REDOCLY_SUPPRESS_UPDATE_NOTICE ?? null,",
        "  telemetry: process.env.REDOCLY_TELEMETRY ?? null,",
        '}) + "\\n");',
      ].join("\n"),
    );
    const res = run("api-lint.mjs", [], {
      ...cleanEnv(["CI", "NODE_ENV", "REDOCLY_", "NODE_OPTIONS"]),
      NODE_OPTIONS: `--import=${pathToFileURL(preload).href}`,
      TEACHBACK_ENV_LOG: log,
    });
    expect(res.status).toBe(0);
    const runs = readFileSync(log, "utf8")
      .trim()
      .split("\n")
      .map(
        (line) =>
          JSON.parse(line) as {
            script: string;
            args: string[];
            suppress: string | null;
            telemetry: string | null;
          },
      );
    const redocly = runs.filter((r) =>
      /@redocly[\\/]cli[\\/]bin[\\/]cli\.js$/.test(r.script ?? ""),
    );
    expect(redocly).toHaveLength(1);
    expect(redocly[0].suppress).toBe("true");
    expect(redocly[0].telemetry).toBe("off");
    // Exactly `lint <spec>`: a --skip-rule or another flag would weaken the lint unseen.
    expect(redocly[0].args.map((a) => a.replace(/\\/g, "/"))).toEqual([
      "lint",
      "openapi/openapi.yaml",
    ]);
  });

  it("applies redocly.yaml's strict rules to any spec path", () => {
    // A tag without a description is only a warning under Redocly's default rules.
    const dir = dirs.make();
    const copy = path.join(dir, "openapi.yaml");
    writeFileSync(
      copy,
      readFileSync(SPEC_PATH, "utf8").replace(
        "    description: Liveness and database status.\n",
        "",
      ),
    );
    const res = run("api-lint.mjs", [copy]);
    expect(res.stdout + res.stderr).toMatch(/tag-description/);
    expect(res.status).not.toBe(0);
  });
});
