---
name: fix-ci
description: Find out why CI (ci-ok or CodeQL) failed on my PR and fix it.
disable-model-invocation: true
allowed-tools: Bash(gh pr checks:*), Bash(gh pr view:*), Bash(gh run list:*), Bash(gh run view:*), Bash(gh run rerun:*), Bash(npm run verify:*), Bash(npm run check), Bash(npm run lint), Bash(npm run typecheck), Bash(npm run test:*), Bash(npm run api:*), Bash(npm run audit), Bash(npm run build), Bash(npm run db:up), Bash(git status:*), Bash(git diff:*), Bash(git branch:*)
---

1. `gh pr checks` for the current branch. Find the failing job (`static`, `test`, `security`, `build`, `e2e`, or CodeQL), then `gh run view <run-id> --log-failed`. Keep only the relevant error lines.
   - For CodeQL, open the alert from the PR's checks and read the finding. Never dismiss an alert: fix the code. If you think it's a false positive, explain why and ask the lead to decide.
2. Reproduce it locally with the same npm script (or `npm run verify`).
3. Fix the root cause.
   - Never disable lint rules, skip tests, lower thresholds, or add `@ts-ignore`/`any` to get green.
   - For `npm audit`, prefer upgrading the package. If no fix exists, tell me and the lead.
   - For gitleaks, if a real secret was pushed: tell me to **revoke the key now**, then remove it. If it's a false positive, add its fingerprint (from the log) to `.gitleaksignore`, since a marker added in a later commit doesn't clear the earlier one, and explain. A `.gitleaksignore` entry needs the lead's review: say so, and tell me not to merge until the lead approves.
4. `npm run verify`, then commit `fix(ci): <what> (#<n>)` (no AI attribution) and `git push`. Then check the `/finish-task` step 9 list again on the whole PR diff (`git diff origin/main...HEAD`). If it now matches, request the lead with `gh pr edit <number> --add-reviewer <lead>` (the `lead` login in `.github/team.json`) and tell me not to merge until they approve.
5. `gh pr checks --watch`.
6. If the failure is infrastructure (network, registry, runner) and not our code, run `gh run rerun <run-id> --failed` instead.
