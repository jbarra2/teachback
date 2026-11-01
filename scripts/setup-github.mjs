#!/usr/bin/env node
/**
 * Creates the project's GitHub labels, milestones and issues (with "blocked by"
 * dependencies) from scripts/backlog.json. Requires the GitHub CLI (`gh auth login`).
 *
 *   node scripts/setup-github.mjs --dry-run   # show what would be created (reads only)
 *   node scripts/setup-github.mjs             # create labels, milestones, issues, dependencies
 *   node scripts/setup-github.mjs --assign    # assign issues using .github/team.json
 *                                             # (run after teammates accept their invites)
 *   node scripts/setup-github.mjs --protect   # security settings + main-branch ruleset
 *                                             # (run after T01 is merged; needs repo admin)
 *   node scripts/setup-github.mjs --check-protect  # compare the live ruleset with
 *                                             # scripts/protect-main-ruleset.json (reads only)
 *
 * Safe to re-run: labels are upserted, and milestones/issues that already exist
 * (issues matched by their "Txx" title prefix) are reused, not duplicated.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rulesetDifferences } from "./ruleset-check.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const flags = new Set(process.argv.slice(2));
const DRY = flags.has("--dry-run");
const ASSIGN = flags.has("--assign");
const PROTECT = flags.has("--protect");
const CHECK_PROTECT = flags.has("--check-protect");

const backlog = JSON.parse(
  readFileSync(path.join(root, "scripts", "backlog.json"), "utf8"),
);
const TRACK_NAMES = {
  lead: "Platform, data & security (lead)",
  ai: "AI & ingestion",
  frontend: "Frontend",
};

// ---------- gh helpers ----------
const quote = (s) => (/[\s"'#&|<>]/.test(s) ? JSON.stringify(s) : s);
const isWrite = (argv) =>
  (argv[0] === "label" && argv[1] === "create") ||
  (argv[0] === "issue" && (argv[1] === "create" || argv[1] === "edit")) ||
  (argv[0] === "api" && argv.includes("POST"));

function gh(argv, { input, allowFail = false } = {}) {
  if (DRY && isWrite(argv)) {
    console.log(`    [dry-run] gh ${argv.map(quote).join(" ")}`);
    return "";
  }
  try {
    return execFileSync("gh", argv, {
      input,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      maxBuffer: 20 * 1024 * 1024,
    }).trim();
  } catch (err) {
    if (allowFail) return null;
    const detail = (err.stderr || err.message || "").toString().trim();
    throw new Error(`gh ${argv.join(" ")} failed:\n${detail}`);
  }
}

const ghJson = (argv) => JSON.parse(gh(argv) || "null");

function fail(msg) {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
}

// ---------- preflight ----------
try {
  execFileSync("gh", ["--version"], { stdio: "ignore" });
} catch {
  fail(
    "GitHub CLI not found. Install it (https://cli.github.com) and run `gh auth login`.",
  );
}
// Check that gh can actually call the API as you (more reliable than `gh auth status`,
// which also fails when an unrelated saved account or token has a problem).
let login;
try {
  login = execFileSync("gh", ["api", "user", "--jq", ".login"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
} catch (err) {
  const said =
    (err.stderr || err.message || "").toString().trim() || "(no output)";
  const envToken = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  fail(
    `The GitHub CLI can't call the API with your login.\n  gh said: ${said}\n  ` +
      (envToken
        ? "A GH_TOKEN or GITHUB_TOKEN environment variable is set, and gh uses it instead of your login. Remove it (or fix it) and try again."
        : "Run `gh auth status` to see which account is the problem, then `gh auth login` (GitHub.com → HTTPS → Login with a web browser)."),
  );
}
console.log(`Signed in to GitHub as ${login}`);

const repo = ghJson(["repo", "view", "--json", "nameWithOwner"]).nameWithOwner;
console.log(
  `\nRepository: ${repo}${DRY ? "  (dry run: nothing will be created)" : ""}\n`,
);

const titleFor = (t) => `${t.id} · ${t.title}`;
const idOf = (title) => (title.match(/^(T\d{2})\b/) || [])[1];

function existingIssues() {
  const list =
    ghJson([
      "issue",
      "list",
      "--state",
      "all",
      "--limit",
      "500",
      "--json",
      "number,title,assignees",
    ]) || [];
  const byId = new Map();
  for (const issue of list) {
    const id = idOf(issue.title);
    if (id && !byId.has(id)) byId.set(id, issue);
  }
  return byId;
}

// ---------- --assign mode ----------
if (ASSIGN) {
  const teamPath = path.join(root, ".github", "team.json");
  if (!existsSync(teamPath)) fail(".github/team.json not found.");
  const team = JSON.parse(readFileSync(teamPath, "utf8"));
  const placeholders = Object.entries(team).filter(
    ([, v]) => !v || v.includes("<"),
  );
  if (placeholders.length)
    fail(
      `Fill in GitHub usernames in .github/team.json first (${placeholders.map(([k]) => k).join(", ")}).`,
    );

  const issues = existingIssues();
  let problems = 0;
  for (const task of backlog.tasks) {
    const issue = issues.get(task.id);
    const user = team[backlog.tracks[task.track].teamKey];
    if (!issue) {
      console.log(
        `  ! ${task.id} has no issue yet. Run without --assign first.`,
      );
      problems++;
      continue;
    }
    if (
      issue.assignees?.some((a) => a.login.toLowerCase() === user.toLowerCase())
    ) {
      console.log(
        `  = #${issue.number} ${task.id} already assigned to ${user}`,
      );
      continue;
    }
    const ok = gh(
      ["issue", "edit", String(issue.number), "--add-assignee", user],
      { allowFail: true },
    );
    if (ok === null) {
      console.log(
        `  ! #${issue.number} ${task.id}: could not assign ${user}. Have they accepted the repo invite?`,
      );
      problems++;
    } else {
      console.log(`  ✓ #${issue.number} ${task.id} → ${user}`);
    }
  }
  console.log(
    problems ? `\nDone with ${problems} problem(s).` : "\nAll issues assigned.",
  );
  process.exit(problems ? 1 : 0);
}

// ---------- main-branch ruleset ----------
// scripts/protect-main-ruleset.json, pinned by tests/tooling/project-config.test.ts.
// No approval: PRs merge on green checks, and the lead reviews teammates' risky PRs by team rule
// (CONTRIBUTING, "Reviews"). `ci-ok` must come from GitHub Actions (app 15368), which stops a
// hand-posted commit status from passing as ci-ok. It doesn't stop a PR from changing ci.yml
// itself (a PR's CI runs the PR's own workflow), so CI files need the lead's review.
const ruleset = JSON.parse(
  readFileSync(path.join(root, "scripts", "protect-main-ruleset.json"), "utf8"),
);

/** How the live ruleset differs from the reviewed file (reads only). */
function liveRulesetDifferences() {
  const list = ghJson(["api", `repos/${repo}/rulesets`]) || [];
  const found = list.find((r) => r.name === ruleset.name);
  if (!found) return null;
  return rulesetDifferences(
    ruleset,
    ghJson(["api", `repos/${repo}/rulesets/${found.id}`]),
  );
}

// ---------- --check-protect mode (reads only) ----------
if (CHECK_PROTECT) {
  const diffs = liveRulesetDifferences();
  if (diffs === null)
    fail(`No ruleset named "${ruleset.name}". Run with --protect.`);
  for (const d of diffs) console.log(`  ! ${d}`);
  console.log(
    diffs.length
      ? `\nThe live ruleset differs (${diffs.length}). Fix it in Settings → Rules → Rulesets → ${ruleset.name}.`
      : "\nThe live ruleset matches scripts/protect-main-ruleset.json.",
  );
  process.exit(diffs.length ? 1 : 0);
}

// ---------- --protect mode ----------
if (PROTECT) {
  const steps = [
    {
      name: "Merge settings: squash only, delete branches after merge",
      manual: "Settings → General → Pull Requests",
      run: () =>
        gh(
          [
            "api",
            "-X",
            "PATCH",
            `repos/${repo}`,
            "-F",
            "allow_squash_merge=true",
            "-F",
            "allow_merge_commit=false",
            "-F",
            "allow_rebase_merge=false",
            "-F",
            "delete_branch_on_merge=true",
            "-f",
            "squash_merge_commit_title=PR_TITLE",
            "-f",
            "squash_merge_commit_message=COMMIT_MESSAGES",
          ],
          { allowFail: true },
        ),
    },
    {
      name: "Secret scanning + push protection",
      manual: "Settings → Code security → Secret protection",
      run: () =>
        gh(["api", "-X", "PATCH", `repos/${repo}`, "--input", "-"], {
          allowFail: true,
          input: JSON.stringify({
            security_and_analysis: {
              secret_scanning: { status: "enabled" },
              secret_scanning_push_protection: { status: "enabled" },
            },
          }),
        }),
    },
    {
      name: "Dependabot alerts",
      manual: "Settings → Code security → Dependabot alerts",
      run: () =>
        gh(["api", "-X", "PUT", `repos/${repo}/vulnerability-alerts`], {
          allowFail: true,
        }),
    },
    {
      name: "Dependabot security updates",
      manual: "Settings → Code security → Dependabot security updates",
      run: () =>
        gh(["api", "-X", "PUT", `repos/${repo}/automated-security-fixes`], {
          allowFail: true,
        }),
    },
    {
      name: "CodeQL default setup (extended queries)",
      manual:
        "Settings → Code security → Code scanning → CodeQL → Set up → Default, then Edit → query suite Extended",
      run: () =>
        gh(
          [
            "api",
            "-X",
            "PATCH",
            `repos/${repo}/code-scanning/default-setup`,
            "--input",
            "-",
          ],
          {
            allowFail: true,
            input: JSON.stringify({
              state: "configured",
              query_suite: "extended",
            }),
          },
        ),
    },
    {
      name: "Ruleset 'protect main': PR (no approval needed), ci-ok, CodeQL, no force-push/deletion",
      manual:
        "Settings → Rules → Rulesets: make 'protect main' match scripts/protect-main-ruleset.json (--check-protect lists the differences)",
      run: () => {
        const diffs = liveRulesetDifferences();
        if (diffs === null)
          return gh(
            ["api", "-X", "POST", `repos/${repo}/rulesets`, "--input", "-"],
            { allowFail: true, input: JSON.stringify(ruleset) },
          );
        // An existing ruleset is never overwritten: show how it drifted, and fix it by hand.
        for (const d of diffs) console.log(`    ! ${d}`);
        return diffs.length ? null : "exists";
      },
    },
  ];
  let failed = 0;
  for (const step of steps) {
    if (DRY) {
      console.log(`  [dry-run] ${step.name}`);
      continue;
    }
    const res = step.run();
    if (res === null) {
      failed++;
      console.log(`  ! ${step.name}: failed. Do it by hand: ${step.manual}`);
    } else
      console.log(`  ✓ ${step.name}${res === "exists" ? " (exists)" : ""}`);
  }
  console.log(
    failed
      ? `\n${failed} step(s) need doing by hand (see above).`
      : "\nRepository protections are on.",
  );
  process.exit(failed ? 1 : 0);
}

// ---------- labels ----------
console.log("Labels");
for (const label of backlog.labels) {
  gh([
    "label",
    "create",
    label.name,
    "--color",
    label.color,
    "--description",
    label.description,
    "--force",
  ]);
  if (!DRY) console.log(`  ✓ ${label.name}`);
}

// ---------- milestones ----------
console.log("\nMilestones");
const existingMilestones =
  ghJson(["api", `repos/${repo}/milestones?state=all&per_page=100`]) || [];
const milestoneTitle = {};
for (const m of backlog.milestones) {
  milestoneTitle[m.key] = m.title;
  if (existingMilestones.some((e) => e.title === m.title)) {
    console.log(`  = ${m.title} (exists)`);
    continue;
  }
  gh([
    "api",
    `repos/${repo}/milestones`,
    "--method",
    "POST",
    "-f",
    `title=${m.title}`,
    "-f",
    `due_on=${m.due}T12:00:00Z`,
    "-f",
    `description=${m.description}`,
  ]);
  if (!DRY) console.log(`  ✓ ${m.title} (due ${m.due})`);
}

// ---------- issues ----------
console.log("\nIssues");
const issues = existingIssues();
const numberOf = new Map([...issues].map(([id, issue]) => [id, issue.number]));
const ref = (id) => (numberOf.has(id) ? `#${numberOf.get(id)}` : `#<${id}>`);
const taskById = new Map(backlog.tasks.map((t) => [t.id, t]));

for (const task of backlog.tasks) {
  for (const dep of task.blockedBy) {
    const depTask = taskById.get(dep);
    if (!depTask) fail(`${task.id} is blocked by unknown task ${dep}.`);
    if (backlog.tasks.indexOf(depTask) > backlog.tasks.indexOf(task))
      fail(
        `${task.id} is blocked by ${dep}, which comes later in backlog.json.`,
      );
  }
}

function bodyFor(task) {
  const blockers = task.blockedBy.length
    ? task.blockedBy
        .map((id) => `- ${ref(id)} ${titleFor(taskById.get(id))}`)
        .join("\n")
    : "- Nothing. Ready as soon as it's assigned.";
  return [
    `**Goal:** ${task.goal}`,
    "",
    "### Acceptance criteria",
    ...task.acceptance.map((a) => `- [ ] ${a}`),
    "",
    "### Blocked by",
    blockers,
    "",
    "### Details",
    `- **Track:** ${TRACK_NAMES[task.track]} (\`${task.track}\`)`,
    `- **Planned:** ${task.date}`,
    `- **Milestone:** ${milestoneTitle[task.milestone]}`,
    `- **Spec:** ${task.refs.startsWith("docs/") ? task.refs : `docs/PLAN.md (${task.refs})`}`,
    "",
    "### How to work on this",
    "In Claude Code: `/start-task <this issue's number>` → `/test-task` → `/security-review` → `/finish-task`. Security requirements: docs/TESTING.md §3. See CONTRIBUTING.md.",
  ].join("\n");
}

for (const task of backlog.tasks) {
  if (numberOf.has(task.id)) {
    console.log(`  = #${numberOf.get(task.id)} ${titleFor(task)} (exists)`);
    continue;
  }
  const labels = [backlog.tracks[task.track].label];
  if (task.critical) labels.push("critical-path");
  if (task.stretch) labels.push("stretch");
  if (task.security) labels.push("security");
  const argv = [
    "issue",
    "create",
    "--title",
    titleFor(task),
    "--body-file",
    "-",
    "--milestone",
    milestoneTitle[task.milestone],
  ];
  for (const l of labels) argv.push("--label", l);
  const out = gh(argv, { input: bodyFor(task) });
  if (DRY) continue;
  const num = Number((out.match(/\/issues\/(\d+)/) || [])[1]);
  if (!num) fail(`Could not read the new issue number from: ${out}`);
  numberOf.set(task.id, num);
  console.log(`  ✓ #${num} ${titleFor(task)}`);
}

// ---------- dependencies ----------
console.log("\nDependencies (blocked by)");
const dbIdCache = new Map();
const dbId = (num) => {
  if (!dbIdCache.has(num))
    dbIdCache.set(
      num,
      gh(["api", `repos/${repo}/issues/${num}`, "--jq", ".id"]),
    );
  return dbIdCache.get(num);
};
let depProblems = 0;
for (const task of backlog.tasks) {
  if (!task.blockedBy.length) continue;
  if (DRY) {
    console.log(
      `  [dry-run] ${task.id} blocked by ${task.blockedBy.join(", ")}`,
    );
    continue;
  }
  const num = numberOf.get(task.id);
  const current = gh(
    [
      "api",
      `repos/${repo}/issues/${num}/dependencies/blocked_by`,
      "--jq",
      ".[].number",
    ],
    { allowFail: true },
  );
  if (current === null) {
    console.log(
      `  ! #${num}: couldn't read dependencies (feature unavailable?). The "Blocked by" list in the issue body still applies.`,
    );
    depProblems++;
    continue;
  }
  const already = new Set(current.split(/\s+/).filter(Boolean).map(Number));
  for (const dep of task.blockedBy) {
    const depNum = numberOf.get(dep);
    if (already.has(depNum)) continue;
    const res = gh(
      [
        "api",
        `repos/${repo}/issues/${num}/dependencies/blocked_by`,
        "--method",
        "POST",
        "-F",
        `issue_id=${dbId(depNum)}`,
      ],
      { allowFail: true },
    );
    if (res === null) {
      console.log(`  ! #${num} ${task.id} ← #${depNum} ${dep}: could not add`);
      depProblems++;
    }
  }
  console.log(
    `  ✓ #${num} ${task.id} blocked by ${task.blockedBy.map((d) => `#${numberOf.get(d)}`).join(", ")}`,
  );
}

console.log(
  DRY
    ? "\nDry run complete. Run again without --dry-run to create everything."
    : `\nDone${depProblems ? ` with ${depProblems} dependency problem(s)` : ""}. Next: fill in .github/team.json, invite teammates, then run with --assign once they accept.`,
);
