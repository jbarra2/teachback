/**
 * Compares the live "protect main" ruleset with the reviewed one in scripts/protect-main-ruleset.json.
 * Used by `setup-github.mjs --protect` and `--check-protect` (read-only). Node built-ins only.
 */
import { isDeepStrictEqual } from "node:util";

const show = (value) => JSON.stringify(value) ?? "nothing";

/**
 * Lists how `live` (GitHub's GET /rulesets/{id} response) differs from `expected`. GitHub adds its
 * own fields (ids, links, timestamps, defaults such as allowed_merge_methods), so only what the
 * reviewed file sets is compared. Bypass actors must stay empty, and every rule must appear once.
 * @returns {string[]} one line per difference; empty when they match
 */
export function rulesetDifferences(expected, live) {
  const diffs = [];
  for (const key of ["name", "target", "enforcement", "conditions"])
    if (!isDeepStrictEqual(live?.[key], expected[key]))
      diffs.push(
        `${key}: expected ${show(expected[key])}, live ${show(live?.[key])}`,
      );
  // GitHub returns bypass_actors only to someone who can edit the ruleset (a repo admin), so a
  // missing field means "can't tell", never "none".
  if (!Array.isArray(live?.bypass_actors))
    diffs.push("bypass_actors: not visible (run this as a repo admin)");
  else if (live.bypass_actors.length > 0)
    diffs.push(
      `bypass_actors: expected none, live ${show(live.bypass_actors)}`,
    );
  const liveRules = live?.rules ?? [];
  for (const rule of expected.rules) {
    const found = liveRules.filter((r) => r.type === rule.type);
    if (found.length !== 1) {
      diffs.push(
        `rule ${rule.type}: expected once, live ${found.length} time(s)`,
      );
      continue;
    }
    for (const [param, value] of Object.entries(rule.parameters ?? {})) {
      const liveValue = found[0].parameters?.[param];
      if (!isDeepStrictEqual(liveValue, value))
        diffs.push(
          `rule ${rule.type}.${param}: expected ${show(value)}, live ${show(liveValue)}`,
        );
    }
  }
  for (const rule of liveRules)
    if (!expected.rules.some((r) => r.type === rule.type))
      diffs.push(`rule ${rule.type}: live, but not in the reviewed ruleset`);
  return diffs;
}
