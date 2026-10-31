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
