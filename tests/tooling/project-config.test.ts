import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";

// Pins the settings the quality gate and the security decisions depend on, so a change to them
// is a deliberate edit to this test (reviewed by the lead), not a silent side effect.
const root = path.resolve(import.meta.dirname, "../..");
const { scripts } = JSON.parse(
  readFileSync(path.join(root, "package.json"), "utf8"),
) as { scripts: Record<string, string> };

describe("npm scripts (pre-push runs check; CI and verify run the rest)", () => {
  it("check runs format, lint, typecheck and the unit tests", () => {
    expect(scripts.check).toBe(
      "npm run format:check && npm run lint && npm run typecheck && npm run test",
    );
  });

  it("lint covers the whole repo and fails on warnings", () => {
    expect(scripts.lint).toBe("eslint . --max-warnings=0");
  });

  it("typecheck generates Next's route types first", () => {
    expect(scripts.typecheck).toBe("next typegen && tsc --noEmit");
  });

  // check-test-inventory.mjs also fails if these stop running every test file they should.
  it("test checks the test inventory, then runs both unit projects", () => {
    expect(scripts.test).toBe(
      "node scripts/check-test-inventory.mjs && vitest run --project unit --project unit-dom",
    );
  });

  it("test:ci checks the test inventory, then runs the tests with coverage", () => {
    expect(scripts["test:ci"]).toBe(
      "node scripts/check-test-inventory.mjs && vitest run --project unit --project unit-dom --coverage",
    );
  });

  it("audit fails on high and critical production advisories", () => {
    expect(scripts.audit).toBe("npm audit --omit=dev --audit-level=high");
  });

  it.each(["dev", "start"])(
    "%s listens on this machine only (127.0.0.1)",
    (name) => {
      expect(scripts[name]).toMatch(/ -H 127\.0\.0\.1$/);
    },
  );
});

describe("toolchain: one Node and npm for the team and CI", () => {
  // npm 10 and npm 11 below 11.11 drop the lockfile's `libc` fields, so a machine on one of them
  // rewrites package-lock.json on every install. npm 12 is untested, so it's out until checked.
  // devEngines makes npm itself refuse the wrong version.
  type Pkg = {
    engines?: { node?: string };
    devEngines?: { runtime?: { version?: string } };
  };
  const pkg = JSON.parse(
    readFileSync(path.join(root, "package.json"), "utf8"),
  ) as Pkg;
  const lock = JSON.parse(
    readFileSync(path.join(root, "package-lock.json"), "utf8"),
  ) as { packages: Record<string, { engines?: unknown; libc?: unknown }> };
  const ci = readFileSync(path.join(root, ".github/workflows/ci.yml"), "utf8");
  const setupNodeSteps = (ci.match(/uses: actions\/setup-node@/g) ?? []).length;

  it("devEngines refuses a Node or npm that would rewrite the lockfile", () => {
    expect(pkg.devEngines).toEqual({
      runtime: { name: "node", version: ">=24", onFail: "error" },
      packageManager: {
        name: "npm",
        version: ">=11.11.0 <12",
        onFail: "error",
      },
    });
  });

  it("engines.node, devEngines and CI's NODE_VERSION name the same Node", () => {
    expect(pkg.engines).toEqual({ node: ">=24" });
    expect(pkg.engines?.node).toBe(pkg.devEngines?.runtime?.version);
    const floor = /^>=(\d+)$/.exec(pkg.devEngines?.runtime?.version ?? "");
    expect(floor).not.toBeNull();
    expect(ci).toMatch(new RegExp(`^ {2}NODE_VERSION: "${floor?.[1]}"$`, "m"));
  });

  it("the lockfile was written by an npm in range (root engines and libc fields kept)", () => {
    expect(lock.packages[""].engines).toEqual(pkg.engines);
    // npm 10 and npm 11 below 11.11 strip every `libc` field when they rewrite the lockfile.
    const withLibc = Object.values(lock.packages).filter((p) =>
      Array.isArray(p.libc),
    );
    expect(withLibc.length).toBeGreaterThan(0);
  });

  it("every CI job sets up Node 24 from one NODE_VERSION", () => {
    expect(ci).toMatch(/^ {2}NODE_VERSION: "24"$/m);
    // Exactly one definition: a job-level `env:` override would win over the workflow's.
    expect(ci.match(/NODE_VERSION:/g) ?? []).toHaveLength(1);
    const versions = [...ci.matchAll(/node-version:\s*"([^"]*)"/g)].map(
      (m) => m[1],
    );
    expect(versions.length).toBeGreaterThan(0);
    expect(versions.length).toBe(setupNodeSteps);
    for (const v of versions) expect(v).toBe("${{ env.NODE_VERSION }}");
  });

  it("every setup-node step either caches npm or turns the auto-cache off", () => {
    const cacheChoices = (
      ci.match(/cache: npm\b|package-manager-cache: false\b/g) ?? []
    ).length;
    expect(setupNodeSteps).toBeGreaterThan(0);
    expect(cacheChoices).toBe(setupNodeSteps);
  });
});

describe("AI attribution stays out of git history (CLAUDE.md rule 7)", () => {
  it("Claude Code adds no attribution or session link to commits and PRs", () => {
    const settings = JSON.parse(
      readFileSync(path.join(root, ".claude/settings.json"), "utf8"),
    ) as { attribution?: unknown };
    expect(settings.attribution).toEqual({
      commit: "",
      pr: "",
      sessionUrl: false,
    });
  });
});

describe("team logins (.github/team.json, CODEOWNERS)", () => {
  const team = JSON.parse(
    readFileSync(path.join(root, ".github/team.json"), "utf8"),
  ) as Record<string, string>;
  // GitHub logins: letters, digits and single hyphens, up to 39 characters.
  const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;

  it("names a different GitHub login for each role", () => {
    expect(Object.keys(team).sort()).toEqual(["ai", "frontend", "lead"]);
    for (const login of Object.values(team)) expect(login).toMatch(LOGIN);
    expect(new Set(Object.values(team)).size).toBe(3);
  });

  // PLAN §2: these paths belong to the AI and frontend tracks; every other line is the lead's.
  const TRACK_PATHS: Record<string, string[]> = {
    ai: [
      "/tests/e2e/",
      "/src/lib/ai/",
      "/src/lib/ingest/",
      "/src/app/api/documents/",
      "/src/app/api/concepts/",
      "/src/app/api/questions/",
    ],
    frontend: [
      "/src/app/(app)/",
      "/src/app/(auth)/",
      "/src/components/",
      "/src/lib/api-client/",
      "/src/lib/mastery/",
    ],
  };
  const codeowners = readFileSync(path.join(root, ".github/CODEOWNERS"), "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim() && !line.trim().startsWith("#"))
    .map((line) => line.trim().split(/\s+/));

  it("CODEOWNERS gives each path to its track's owner, with no placeholders", () => {
    expect(codeowners.length).toBeGreaterThan(0);
    for (const [pattern, ...owners] of codeowners) {
      const role =
        Object.keys(TRACK_PATHS).find((r) =>
          TRACK_PATHS[r].includes(pattern),
        ) ?? "lead";
      expect(owners, pattern).toEqual([`@${team[role]}`]);
    }
  });

  it("CODEOWNERS covers every AI and frontend path", () => {
    const patterns = codeowners.map(([pattern]) => pattern);
    for (const p of [...TRACK_PATHS.ai, ...TRACK_PATHS.frontend])
      expect(patterns).toContain(p);
  });
});

describe(".gitleaks.toml (the CI secret scan)", () => {
  // gitleaks reads this file from the repo root. Anything beyond the default rules (an allowlist,
  // a path exemption, `useDefault = false`) would weaken CI's scan with no other test noticing.
  it("uses gitleaks' default rules with no allowlist", () => {
    const settings = readFileSync(path.join(root, ".gitleaks.toml"), "utf8")
      .split(/\r?\n/)
      .map((line) => line.replace(/#.*/, "").trim())
      .filter(Boolean);
    expect(settings).toEqual(["[extend]", "useDefault = true"]);
  });
});

describe("next.config.ts", () => {
  it("turns off the dev MCP endpoint (/_next/mcp)", () => {
    expect(nextConfig.experimental?.mcpServer).toBe(false);
  });

  it("stops `next dev` from writing AGENTS.md (CLAUDE.md holds agent instructions)", () => {
    expect(nextConfig.agentRules).toBe(false);
  });

  it("leaves cacheComponents off (PLAN §3)", () => {
    expect(nextConfig.cacheComponents).not.toBe(true);
  });
});
