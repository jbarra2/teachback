import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { load } from "js-yaml";
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

  // A pre/post script runs around every `npm run` (a `pretest:ci` could delete tests before they
  // run), so a new script is a deliberate edit here, which needs the lead's review.
  it("has exactly the reviewed scripts", () => {
    expect(Object.keys(scripts).sort()).toEqual([
      "ai:ping",
      "api:lint",
      "api:types",
      "api:types:check",
      "audit",
      "build",
      "check",
      "db:down",
      "db:up",
      "dev",
      "format",
      "format:check",
      "lint",
      "prepare",
      "setup",
      "start",
      "test",
      "test:ci",
      "typecheck",
      "verify",
    ]);
  });

  it("audit fails on high and critical production advisories", () => {
    expect(scripts.audit).toBe("npm audit --omit=dev --audit-level=high");
  });

  // CI and verify run these (--if-present in ci.yml; the list above keeps them present).
  // tests/tooling/api-scripts.test.ts tests what the scripts do.
  it("api:lint, api:types and api:types:check run the reviewed contract scripts", () => {
    expect(scripts["api:lint"]).toBe("node scripts/api-lint.mjs");
    expect(scripts["api:types"]).toBe("node scripts/api-types.mjs");
    expect(scripts["api:types:check"]).toBe(
      "node scripts/api-types.mjs --check",
    );
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
    // Exactly one definition: a job-level `env:` override would win over the workflow's, and so
    // would a step writing it to $GITHUB_ENV or a job running in a container.
    expect(ci.match(/NODE_VERSION:/g) ?? []).toHaveLength(1);
    expect(ci).not.toMatch(/GITHUB_ENV[^\n]*NODE_VERSION|NODE_VERSION=/);
    expect(ci).not.toMatch(/^\s+container:/m);
    const versions = [...ci.matchAll(/node-version:\s*"([^"]*)"/g)].map(
      (m) => m[1],
    );
    expect(versions.length).toBeGreaterThan(0);
    expect(versions.length).toBe(setupNodeSteps);
    for (const v of versions) expect(v).toBe("${{ env.NODE_VERSION }}");
  });

  // Jobs sit two spaces in under `jobs:` (any id GitHub accepts, a trailing comment allowed).
  // Comments are dropped so they can't count as steps.
  const jobs = ci
    .slice(ci.indexOf("\njobs:\n"))
    .split(/\n(?= {2}[A-Za-z_][\w-]*:)/)
    .slice(1)
    .map((block) => ({
      id: /^ {2}([A-Za-z_][\w-]*):/.exec(block)?.[1] ?? "",
      code: block.replace(/^\s*#.*$/gm, ""),
    }));

  // ci-ok is the one required check (protect-main-ruleset.json), so it must cover every job.
  // It only proves anything for PRs that leave ci.yml alone: a PR's CI runs the PR's own
  // workflow, so CI-defining files need the lead's review (CONTRIBUTING, "Reviews").
  // The tests below explain what each part of ci.yml must do; this one catches every other edit
  // (a `|| true`, a step-level `if: false`, a removed step, a flow-mapping `shell:`). Change ci.yml
  // and this hash together, in a PR the lead reviews.
  it("ci.yml is exactly the reviewed workflow", () => {
    expect(
      createHash("sha256").update(ci.replace(/\r\n/g, "\n")).digest("hex"),
    ).toBe("7e7f721d4e3ee59c7a1a8b47f3e23bae535b3105c99b5fbbe8db5e4295fbc9d2");
  });

  // A tag can be moved to new code, which would then run with this workflow's token and secrets.
  // So an action from outside GitHub's own `actions/` and `github/` is pinned to a full commit SHA,
  // with its release in a comment for the reader (CodeQL's actions/unpinned-tag).
  it("pins every action from outside GitHub to a full commit SHA", () => {
    const workflow = load(ci) as {
      jobs: Record<string, { uses?: string; steps?: { uses?: string }[] }>;
    };
    const refs = Object.values(workflow.jobs)
      .flatMap((job) => [job.uses, ...(job.steps ?? []).map((s) => s.uses)])
      .filter((ref) => ref !== undefined);
    const outside = refs.filter((ref) => !/^(actions|github)\//.test(ref));
    // The current set, so the check can't pass by finding nothing.
    expect(outside.map((ref) => ref.split("@")[0])).toEqual([
      "gitleaks/gitleaks-action",
    ]);
    const releases = new Map(
      [...ci.matchAll(/uses: (\S+) # (v\d+\.\d+\.\d+)$/gm)].map((m) => [
        m[1],
        m[2],
      ]),
    );
    for (const ref of outside) {
      expect(ref).toMatch(/^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/);
      expect(releases.get(ref), `${ref} needs a "# vX.Y.Z" comment`).toMatch(
        /^v\d/,
      );
    }
  });

  it("ci.yml is the only workflow, and nothing in it may fail quietly", () => {
    // GitHub runs every .yml/.yaml file there; anything else (a Mac's .DS_Store) is ignored.
    expect(
      readdirSync(path.join(root, ".github/workflows")).filter((f) =>
        /\.ya?ml$/.test(f),
      ),
    ).toEqual(["ci.yml"]);
    expect(ci).not.toMatch(/continue-on-error/);
  });

  it("each job runs under the reviewed condition", () => {
    const conditions = Object.fromEntries(
      jobs.map((j) => [j.id, /^ {4}if: (.*)$/m.exec(j.code)?.[1] ?? null]),
    );
    const app = "needs.detect.outputs.app == 'true'";
    expect(conditions).toEqual({
      detect: null,
      deps: app,
      static: app,
      test: app,
      security: null,
      build: app,
      e2e: "needs.detect.outputs.e2e == 'true'",
      "ci-ok": "always()",
    });
    // A skipped need skips the job, which ci-ok counts as passed, so needs are pinned too. Every
    // job that installs with scripts waits for deps (the dependency check).
    const needs = Object.fromEntries(
      jobs.map((j) => [j.id, /^ {4}needs: (.*)$/m.exec(j.code)?.[1] ?? null]),
    );
    expect(needs).toEqual({
      detect: null,
      deps: "detect",
      static: "[detect, deps]",
      test: "[detect, deps]",
      security: "detect",
      build: "[detect, deps]",
      e2e: "[detect, deps]",
      "ci-ok": "[detect, deps, static, test, security, build, e2e]",
    });
    // The whole detect job: its outputs decide which jobs run at all (a skipped job counts as
    // passed for ci-ok), so the step id, the wiring and the checkout are pinned with the tests.
    const detect = jobs.find((j) => j.id === "detect")?.code ?? "";
    expect(detect.trimEnd()).toBe(
      [
        "  detect:",
        "    name: detect",
        "    runs-on: ubuntu-latest",
        "    outputs:",
        "      app: ${{ steps.d.outputs.app }}",
        "      e2e: ${{ steps.d.outputs.e2e }}",
        "    steps:",
        "      - uses: actions/checkout@v5",
        "      - id: d",
        "        run: |",
        `          if [ -f package.json ]; then echo "app=true" >> "$GITHUB_OUTPUT"; else echo "app=false" >> "$GITHUB_OUTPUT"; fi`,
        `          if [ -f playwright.config.ts ]; then echo "e2e=true" >> "$GITHUB_OUTPUT"; else echo "e2e=false" >> "$GITHUB_OUTPUT"; fi`,
      ].join("\n"),
    );
  });

  // The lockfile check only means something if no install script ran before it (the test job
  // runs `npm ci` with scripts first), so the whole deps job is pinned.
  // The dependency check runs with plain Node (no installed package can fake it), before npm
  // reads the lockfile and again on what an install without scripts put on disk.
  it("deps checks dependencies with plain Node, around an install that runs no scripts", () => {
    const deps = jobs.find((j) => j.id === "deps")?.code ?? "";
    expect(deps.trimEnd()).toBe(
      [
        "  deps:",
        "    name: deps (lockfile, before any install script runs)",
        "    needs: detect",
        "    if: needs.detect.outputs.app == 'true'",
        "    runs-on: ubuntu-latest",
        "    timeout-minutes: 10",
        "    steps:",
        "      - uses: actions/checkout@v5",
        "      - uses: actions/setup-node@v5",
        '        with: { node-version: "${{ env.NODE_VERSION }}", cache: npm }',
        "", // the two comment lines (comments are dropped before comparing)
        "",
        "      - run: node scripts/lockfile-check.mjs",
        "      - run: npm ci --ignore-scripts",
        "      - run: node scripts/lockfile-check.mjs --installed",
      ].join("\n"),
    );
  });

  // Everything before `jobs:` applies to every job (a `defaults.run.shell` would turn each step
  // into a no-op), so the header is pinned too.
  it("the workflow header is the reviewed one", () => {
    expect(ci.slice(0, ci.indexOf("\njobs:\n"))).toBe(
      [
        "name: CI",
        "",
        "on:",
        "  pull_request:",
        "  push:",
        "    branches: [main]",
        "  schedule:",
        '    - cron: "17 9 * * 1" # weekly: full-history secret scan + dependency audit',
        "  workflow_dispatch:",
        "",
        "concurrency:",
        "  group: ci-${{ github.ref }}",
        "  cancel-in-progress: ${{ github.event_name == 'pull_request' }}",
        "",
        "permissions:",
        "  contents: read",
        "",
        "env:",
        '  NODE_VERSION: "24"',
        '  NEXT_TELEMETRY_DISABLED: "1"',
        "",
      ].join("\n"),
    );
  });

  // GitHub also reads `"if":` and `if :` as `if`, and a `shell:` or `defaults:` changes what every
  // `run:` does, so none of those may appear anywhere.
  it("has no shell overrides, quoted keys or spaced keys", () => {
    expect(ci).not.toMatch(/^\s*(-\s+)?(shell|defaults)\s*:/m);
    expect(ci).not.toMatch(/^\s*(-\s+)?["'][^"'\n]+["']\s*:/m);
    expect(ci).not.toMatch(/^\s*(-\s+)?[A-Za-z_][\w-]*\s+:/m);
  });

  it("ci-ok waits for every other job and fails if any failed or was cancelled", () => {
    const ciOk = jobs.find((j) => j.id === "ci-ok");
    expect(ciOk).toBeDefined();
    expect(ciOk?.code).toMatch(/^ {4}name: ci-ok$/m);
    const needs = (
      /^ {4}needs: \[([^\]]*)\]$/m.exec(ciOk?.code ?? "")?.[1] ?? ""
    )
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const others = jobs.map((j) => j.id).filter((id) => id !== "ci-ok");
    expect(others.length).toBeGreaterThan(0);
    expect([...needs].sort()).toEqual([...others].sort());
    // One `if:` only (the job's own), and the whole job pinned, so no step-level condition, extra
    // key or early exit can let it pass.
    expect(ciOk?.code.match(/\bif:/g) ?? []).toHaveLength(1);
    expect(ciOk?.code.trimEnd()).toBe(
      [
        "  ci-ok:",
        "    name: ci-ok",
        "    if: always()",
        "    needs: [detect, deps, static, test, security, build, e2e]",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - name: All jobs passed (or were skipped)",
        "        env:",
        "          EVENT: ${{ github.event_name }}",
        "          BASE_REF: ${{ github.base_ref }}",
        "        run: |",
        `          if [ "\${{ contains(needs.*.result, 'failure') || contains(needs.*.result, 'cancelled') }}" = "true" ]; then`,
        '            echo "One or more CI jobs failed."',
        "            exit 1",
        "          fi",
        "", // the comment line (comments are dropped before comparing)
        '          if [ "$EVENT" = "pull_request" ] && [ "$BASE_REF" != "main" ]; then',
        '            echo "This PR targets $BASE_REF. PRs must target main."',
        "            exit 1",
        "          fi",
        '          echo "CI passed."',
      ].join("\n"),
    );
  });

  it("each job that runs node or npm sets up Node first; only jobs that install cache npm", () => {
    // Without setup-node, a job gets the runner's preinstalled Node instead of NODE_VERSION.
    const usesNode = /\b(?:node|np[mx]) \S/;
    const nodeJobs = jobs.filter((j) => usesNode.test(j.code));
    expect(nodeJobs.map((j) => j.id)).toEqual([
      "deps",
      "static",
      "test",
      "security",
      "build",
      "e2e",
    ]);
    for (const { id, code } of nodeJobs) {
      const setupAt = code.indexOf("uses: actions/setup-node@");
      expect(setupAt, `${id} sets up Node`).toBeGreaterThan(-1);
      expect(setupAt, `${id} sets up Node before using it`).toBeLessThan(
        code.search(usesNode),
      );
      // The audit-only job turns setup-node's auto-cache off, so it can't save a near-empty cache
      // under the key the installing jobs use.
      const installs = /\bnpm (ci|install)\b/.test(code);
      expect(/\bcache: npm\b/.test(code), `${id} cache: npm`).toBe(installs);
      expect(code.includes("package-manager-cache: false"), id).toBe(!installs);
    }
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

describe("main-branch ruleset (scripts/protect-main-ruleset.json)", () => {
  // What `setup-github.mjs --protect` sends to GitHub for a fresh repo. The live ruleset is
  // changed by hand in GitHub's settings to match. Any change here is a deliberate edit to this test.
  const ruleset: unknown = JSON.parse(
    readFileSync(path.join(root, "scripts/protect-main-ruleset.json"), "utf8"),
  );

  it("requires a PR, ci-ok from GitHub Actions and CodeQL, blocks force-push and deletion, and needs no approval", () => {
    expect(ruleset).toEqual({
      name: "protect main",
      target: "branch",
      enforcement: "active",
      conditions: {
        ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] },
      },
      rules: [
        { type: "deletion" },
        { type: "non_fast_forward" },
        {
          type: "pull_request",
          // No approval: the lead reviews teammates' risky PRs by team rule (CONTRIBUTING).
          parameters: {
            required_approving_review_count: 0,
            require_extra_approval_for_unattributed_changes: false,
            dismiss_stale_reviews_on_push: true,
            require_code_owner_review: false,
            require_last_push_approval: false,
            required_review_thread_resolution: false,
          },
        },
        {
          type: "required_status_checks",
          parameters: {
            strict_required_status_checks_policy: false,
            // 15368 is the GitHub Actions app: a commit status posted by hand can't pass as ci-ok.
            // A PR can still change ci.yml itself, which is why CI files need the lead's review.
            required_status_checks: [
              { context: "ci-ok", integration_id: 15368 },
            ],
          },
        },
        {
          type: "code_scanning",
          parameters: {
            // medium_or_higher: with no approvals, CodeQL also blocks Medium alerts (XSS, open redirect).
            code_scanning_tools: [
              {
                tool: "CodeQL",
                security_alerts_threshold: "medium_or_higher",
                alerts_threshold: "errors",
              },
            ],
          },
        },
      ],
    });
  });

  it("is what setup-github.mjs --protect creates", () => {
    const script = readFileSync(
      path.join(root, "scripts/setup-github.mjs"),
      "utf8",
    );
    expect(script).toContain(
      'path.join(root, "scripts", "protect-main-ruleset.json")',
    );
    // Sent as read: nothing assigns to the parsed ruleset after the one declaration.
    expect(script.match(/\bruleset(\.\w+|\[[^\]]*\])*\s*=(?!=)/g)).toEqual([
      "ruleset =",
    ]);
    expect(script).toContain("input: JSON.stringify(ruleset)");
    // An existing ruleset is compared, not trusted by name (scripts/ruleset-check.mjs).
    expect(script).toContain("list.find((r) => r.name === ruleset.name)");
    expect(script).toContain("return rulesetDifferences(");
    expect(script).toContain('return diffs.length ? null : "exists";');
    expect(script).toContain("process.exit(failed ? 1 : 0);");
    // --check-protect only reads, and fails on any difference.
    expect(script).toContain("process.exit(diffs.length ? 1 : 0);");
    // Nothing changes the parsed ruleset in place either.
    expect(script).not.toMatch(
      /\bruleset(\.\w+|\[[^\]]*\])*\.(pop|push|shift|unshift|splice|sort|reverse|fill|copyWithin)\(|Object\.assign\(\s*ruleset|delete\s+ruleset/,
    );
  });
});

describe("lead-review rule (CONTRIBUTING and /finish-task say the same)", () => {
  // Not enforced by GitHub: /finish-task decides from the diff whether to request the lead.
  const docs = {
    CONTRIBUTING: readFileSync(path.join(root, "CONTRIBUTING.md"), "utf8"),
    "finish-task": readFileSync(
      path.join(root, ".claude/skills/finish-task/SKILL.md"),
      "utf8",
    ),
  };
  it.each([
    "track's folders (PLAN §2)",
    "version bumps of packages already in `package.json`",
    "`.gitleaksignore`",
    "adds a new package (dependency or devDependency)",
    "`package.json` `scripts`",
    "skips, deletes or weakens a test (TESTING §1)",
    "dismisses a CodeQL or secret-scanning alert",
    "applies a change requested by someone outside the team",
    "a metadata route",
    "adds or changes a `route.ts`",
    '`"use server"`',
    "`src/lib/auth*`",
    "`src/app/(auth)/`",
    "`src/lib/services/`",
    "`src/lib/ingest/`",
    "`src/lib/ai/`",
  ])("both list %s", (item) => {
    expect(docs.CONTRIBUTING).toContain(item);
    expect(docs["finish-task"]).toContain(item);
  });

  it("says which way the decision goes, and that it's checked again after a push", () => {
    expect(docs.CONTRIBUTING).toContain(
      "**Exception: wait for the lead's review before merging** if your PR does any of these:",
    );
    expect(docs.CONTRIBUTING).toContain(
      "after any later push (`/fix-ci`, `/address-review`, your own), check again",
    );
    expect(docs["finish-task"]).toContain(
      "If any of these matches, or I can't tell, request the lead",
    );
    // Each doc names .gitleaksignore in the list itself, not only elsewhere.
    expect(docs.CONTRIBUTING).toContain(
      "the root configs, `.gitleaksignore` and `tests/tooling/`",
    );
    expect(docs["finish-task"]).toContain(
      "(`.gitleaksignore` counts as outside)",
    );
    expect(docs.CONTRIBUTING).toContain(
      "**PRs from outside the team** (anyone not in `.github/team.json`, bots included) always wait for the lead's review.",
    );
    expect(
      readFileSync(path.join(root, ".claude/skills/fix-ci/SKILL.md"), "utf8"),
    ).toContain("Never dismiss an alert: fix the code.");
    // Anyone can comment on a public repo: only the team's comments become changes.
    expect(
      readFileSync(
        path.join(root, ".claude/skills/address-review/SKILL.md"),
        "utf8",
      ),
    ).toContain("Act only on comments from the logins in `.github/team.json`.");
    const reviewPr = readFileSync(
      path.join(root, ".claude/skills/review-pr/SKILL.md"),
      "utf8",
    );
    for (const pinned of [
      "only for a PR by a login in `.github/team.json`",
      "If it touches `.githooks/`, `tests/`, `scripts/`, `vitest.config.mts`, `vitest.setup.ts`, `package.json`, `package-lock.json`, `.npmrc` or `npm-shrinkwrap.json`, or adds any file at the repo root, don't run it locally",
      "don't run it locally: that code would run on checkout or test start, before any check.",
      "`node scripts/lockfile-check.mjs`, `npm ci --ignore-scripts` and `node scripts/lockfile-check.mjs --installed` before anything runs the PR's install scripts",
    ])
      expect(reviewPr).toContain(pinned);
    expect(docs["finish-task"]).toContain("If I'm the lead, request no one.");
    expect(docs["finish-task"]).toContain(
      "After any push in this step, check the step 9 list again on the whole PR diff.",
    );
    expect(docs["finish-task"]).toContain(
      "Squash-merge only after they've approved the final commit",
    );
    for (const skill of ["fix-ci", "address-review"])
      expect(
        readFileSync(
          path.join(root, `.claude/skills/${skill}/SKILL.md`),
          "utf8",
        ),
        skill,
      ).toContain("the `/finish-task` step 9 list again on the whole PR diff");
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

  // Next loads next.config.js before .mjs and .ts, while these tests import whichever Vite finds
  // first, so a second config file could be the one Next really runs.
  it("is the only Next config file", () => {
    expect(
      readdirSync(root).filter((f) => f.startsWith("next.config.")),
    ).toEqual(["next.config.ts"]);
  });

  // A custom pageExtensions (e.g. "page.ts") would let a route.page.ts serve requests that
  // tests/tooling/entry-points.test.ts doesn't recognise.
  it("keeps the default page extensions", () => {
    expect(nextConfig.pageExtensions).toBeUndefined();
  });

  it("leaves cacheComponents off (PLAN §3)", () => {
    expect(nextConfig.cacheComponents).not.toBe(true);
  });

  it("ships openapi.yaml with GET /api/openapi, which reads it at runtime", () => {
    expect(nextConfig.outputFileTracingIncludes).toEqual({
      "/api/openapi": ["./openapi/openapi.yaml"],
    });
  });
});

describe("redocly.yaml (npm run api:lint)", () => {
  // Turning a rule off weakens the contract lint with no other test noticing.
  it("makes every recommended rule an error, with only the reviewed exceptions, and no telemetry", () => {
    const settings = load(
      readFileSync(path.join(root, "redocly.yaml"), "utf8"),
    ) as unknown;
    expect(settings).toEqual({
      extends: ["recommended-strict"],
      rules: {
        "info-license": "off",
        "info-license-strict": "off",
        "operation-4xx-response": "off",
      },
      telemetry: "off",
    });
    // Redocly reads other config files too; this is the only one.
    for (const other of [
      ".redocly.yaml",
      "redocly.yml",
      ".redocly.lint-ignore.yaml",
    ])
      expect(readdirSync(root), other).not.toContain(other);
  });
});
