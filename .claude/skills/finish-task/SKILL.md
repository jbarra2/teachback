---
name: finish-task
description: Finish the current task. Final verify, commit, push, open a PR with test evidence that closes the issue, request review and watch CI.
disable-model-invocation: true
allowed-tools: Bash(npm run verify:*), Bash(git status:*), Bash(git diff:*), Bash(git log:*), Bash(git branch:*), Bash(git fetch:*), Bash(git merge:*), Bash(gh api user:*), Bash(gh issue view:*), Bash(gh pr view:*), Bash(gh pr checks:*)
---

Ship the task on the current branch.

1. **Issue:** take the number from `git branch --show-current`, then `gh issue view <n> --json title,labels`. Never ship from `main`.
2. **Security review gate:** ask me "Did you run `/security-review` on these changes, and are all findings fixed or explained?" If not, stop and tell me to run it first.
3. **Confirm:** show `git status` and a short summary of the changes. Ask: "Commit, sync with main, verify, push and open the PR?" Wait for yes.
4. **Commit first:**
   - Stage only this task's files (never `.env`).
   - Conventional message `<type>(<scope>): <summary> (#<n>)`.
   - **No AI attribution lines.**
   - The hooks run the secret scan, lint/format and message checks. If one blocks, fix the cause. Never use `--no-verify`.
5. **Sync:** `git fetch origin && git merge origin/main`. Resolve conflicts keeping both sides' intent; ask if unsure. For `package-lock.json` conflicts: `git checkout origin/main -- package-lock.json && npm install`, then commit.
6. **Final gate:** `npm run verify` must pass on the merged result. Keep its summary table for the PR. If it fails, fix, commit and re-run, or stop.
7. **Push:** `git push -u origin HEAD` (pre-push runs `npm run check`).
8. **Open the PR.** Title = the issue title. Body = `.github/pull_request_template.md`, filled in completely:
   - `Closes #<n>`
   - what changed
   - how to test (the manual steps from `/test-task`)
   - **Test evidence:** the verify summary, coverage %, and the security matrix table
   - **Security:** the `/security-review` result and how each finding was handled
   - new packages
   - the checklist, ticked honestly
   - no AI footer

   Reviewers: read `.github/team.json`, drop my own login (`gh api user --jq .login`), and request the other two. One approval is enough; CODEOWNERS adds the lead automatically for protected areas. Run `gh pr create --base main --title "<title>" --body-file - --reviewer <user>,<user>` with the body on stdin.

9. **Labels:** `gh issue edit <n> --remove-label in-progress --add-label in-review`.
10. **CI:** `gh pr checks --watch`. If `ci-ok` or CodeQL fails, do the `/fix-ci` steps.
11. **Report:** the PR URL and check status. Then: "Ping your reviewer. After approval + green checks, squash-merge, then `/clear` and `/next-task`."
