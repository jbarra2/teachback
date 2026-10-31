// commit-msg: strip AI attribution lines (team convention) and enforce Conventional Commits.
import { readFileSync, writeFileSync } from "node:fs";

const file = process.argv[2];
const ATTRIBUTION =
  /^(co-authored-by:.*(claude|anthropic).*|claude-session:.*|.*generated with \[?claude code.*)$/i;
const lines = readFileSync(file, "utf8")
  .split(/\r?\n/)
  .filter((l) => !ATTRIBUTION.test(l.trim()));
while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
writeFileSync(file, `${lines.join("\n")}\n`);

const subject = lines.find((l) => l.trim() && !l.startsWith("#")) ?? "";
// Messages git writes itself (merges, reverts, autosquash), not any subject that starts with "Merge".
const GIT_GENERATED =
  /^(Merge (branch|branches|remote-tracking branch|pull request|commit|tag) |Revert "|fixup! |squash! )/;
if (GIT_GENERATED.test(subject)) process.exit(0);

const CONVENTIONAL =
  /^(feat|fix|refactor|perf|test|docs|chore|build|ci|style|revert)(\([a-z0-9./-]+\))?!?: \S.{0,99}$/;
if (!CONVENTIONAL.test(subject)) {
  console.error(`\n✖ Commit message must follow Conventional Commits:\n    <type>(<scope>): <summary> (#<issue>)\n
  e.g.  feat(api): add courses routes (#13)
        fix(ui): stop polling after upload fails (#15)
  types: feat fix refactor perf test docs chore build ci style revert\n
  Yours: "${subject}"\n`);
  process.exit(1);
}
if (!/\(#\d+\)\s*$/.test(subject))
  console.warn("Tip: end the subject with the issue number, e.g. (#13)");
