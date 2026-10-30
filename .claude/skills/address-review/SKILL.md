---
name: address-review
description: Read the review comments on my current PR and fix them.
disable-model-invocation: true
allowed-tools: Bash(gh pr view:*), Bash(gh pr checks:*), Bash(npm run verify:*), Bash(npm run check), Bash(npm run test:*), Bash(git status:*), Bash(git diff:*), Bash(git branch:*)
---

1. Find the PR for this branch: `gh pr view --json number,url,reviews,comments`. For line comments, run `gh api repos/{owner}/{repo}/pulls/<number>/comments`.
2. List each requested change with your planned fix. 🔴 items (especially security) come first. Mark anything you disagree with and explain why. Ask me to confirm.
3. Make the fixes inside the issue's scope. Add or adjust tests so each fix is proven. Run `npm run verify`.
4. Commit `fix: address review feedback (#<issue>)` (no AI attribution) and `git push`.
5. Draft a short reply listing what changed. After I confirm, post it with `gh pr comment <number> --body-file -` and re-request review with `gh pr edit <number> --add-reviewer <reviewer>`.
