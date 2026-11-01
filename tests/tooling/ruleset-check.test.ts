import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { rulesetDifferences } from "../../scripts/ruleset-check.mjs";
import { repoRoot as root } from "../helpers/temp-dirs";

// The live ruleset is what GitHub enforces, and it's edited by hand. `setup-github.mjs
// --check-protect` uses rulesetDifferences to show where it drifted from the reviewed file.
type Rule = { type: string; parameters?: Record<string, unknown> };
type Ruleset = Record<string, unknown> & { rules: Rule[] };
const expected = JSON.parse(
  readFileSync(path.join(root, "scripts/protect-main-ruleset.json"), "utf8"),
) as Ruleset;

/** The reviewed ruleset as GitHub returns it: same settings plus GitHub's own fields. */
function live(change: (r: Ruleset) => void = () => {}): Ruleset {
  const r = structuredClone(expected);
  Object.assign(r, {
    id: 26252767,
    source: "jbarra2/teachback",
    source_type: "Repository",
    node_id: "RRS_x",
    bypass_actors: [],
    current_user_can_bypass: "never",
    created_at: "2026-10-30T00:00:00Z",
    updated_at: "2026-10-31T00:00:00Z",
    _links: { self: { href: "https://api.github.com/x" } },
  });
  const pr = r.rules.find((x) => x.type === "pull_request");
  Object.assign(pr?.parameters ?? {}, {
    allowed_merge_methods: ["merge", "squash", "rebase"],
    required_reviewers: [],
  });
  const checks = r.rules.find((x) => x.type === "required_status_checks");
  Object.assign(checks?.parameters ?? {}, { do_not_enforce_on_create: false });
  change(r);
  return r;
}
const rule = (r: Ruleset, type: string) =>
  r.rules.find((x) => x.type === type)?.parameters ?? {};

describe("rulesetDifferences (scripts/ruleset-check.mjs)", () => {
  it("finds nothing when the live ruleset matches, whatever GitHub adds", () => {
    expect(rulesetDifferences(expected, live())).toEqual([]);
  });

  it.each<[string, (r: Ruleset) => void, string]>([
    [
      "an approval is required again",
      (r) => (rule(r, "pull_request").required_approving_review_count = 1),
      "rule pull_request.required_approving_review_count",
    ],
    [
      "ci-ok accepts any source",
      (r) =>
        (rule(r, "required_status_checks").required_status_checks = [
          { context: "ci-ok" },
        ]),
      "rule required_status_checks.required_status_checks",
    ],
    [
      "CodeQL blocks only High alerts",
      (r) =>
        (rule(r, "code_scanning").code_scanning_tools = [
          {
            tool: "CodeQL",
            security_alerts_threshold: "high_or_higher",
            alerts_threshold: "errors",
          },
        ]),
      "rule code_scanning.code_scanning_tools",
    ],
    [
      "a reviewed parameter is missing",
      (r) => delete rule(r, "pull_request").dismiss_stale_reviews_on_push,
      "rule pull_request.dismiss_stale_reviews_on_push",
    ],
    [
      "a rule has no parameters at all",
      (r) => {
        const codeql = r.rules.find((x) => x.type === "code_scanning");
        if (codeql) delete codeql.parameters;
      },
      "rule code_scanning.code_scanning_tools",
    ],
    [
      "it targets tags instead of branches",
      (r) => (r.target = "tag"),
      "target",
    ],
    [
      "bypass actors aren't visible (not run as an admin)",
      (r) => delete r.bypass_actors,
      "bypass_actors: not visible",
    ],
    [
      "the ruleset only evaluates",
      (r) => (r.enforcement = "evaluate"),
      "enforcement",
    ],
    [
      "it targets another branch",
      (r) =>
        (r.conditions = {
          ref_name: { include: ["refs/heads/other"], exclude: [] },
        }),
      "conditions",
    ],
    [
      "someone may bypass it",
      (r) =>
        (r.bypass_actors = [
          { actor_id: 5, actor_type: "RepositoryRole", bypass_mode: "always" },
        ]),
      "bypass_actors",
    ],
    [
      "the CodeQL rule is gone",
      (r) => (r.rules = r.rules.filter((x) => x.type !== "code_scanning")),
      "rule code_scanning: expected once, live 0",
    ],
    [
      "a rule appears twice",
      (r) => r.rules.push({ type: "deletion" }),
      "rule deletion: expected once, live 2",
    ],
    [
      "an extra rule exists",
      (r) => r.rules.push({ type: "required_signatures" }),
      "rule required_signatures: live, but not in the reviewed ruleset",
    ],
  ])("reports it when %s", (_, change, expectedLine) => {
    const diffs = rulesetDifferences(expected, live(change));
    expect(diffs).toHaveLength(1);
    expect(diffs[0]).toContain(expectedLine);
  });

  it("reports everything when there's no live ruleset at all", () => {
    const diffs = rulesetDifferences(expected, null);
    // name, target, enforcement, conditions, bypass actors, and each of the 5 rules.
    expect(diffs).toHaveLength(10);
    for (const key of [
      "name",
      "target",
      "enforcement",
      "conditions",
      "bypass_actors",
    ])
      expect(
        diffs.some((d) => d.startsWith(`${key}:`)),
        key,
      ).toBe(true);
    for (const rule of expected.rules)
      expect(diffs).toContain(
        `rule ${rule.type}: expected once, live 0 time(s)`,
      );
  });
});
