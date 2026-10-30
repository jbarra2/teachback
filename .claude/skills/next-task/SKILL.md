---
name: next-task
description: Show the GitHub issues assigned to me that are ready to start (all blockers closed) and recommend which one to do next.
disable-model-invocation: true
allowed-tools: Bash(gh api user:*), Bash(gh issue list:*), Bash(gh issue view:*), Bash(git status:*), Bash(git branch:*)
---

Find my next task. Don't start any work; this command only reports.

1. **Who am I:** `gh api user --jq .login`.
2. **My open issues:** `gh issue list --assignee @me --state open --limit 50 --json number,title,labels,milestone`.
   - If none are assigned, say so and tell me to ask the lead to assign one. Stop.
3. **Blockers:** for each issue, read the "Blocked by" section of its body (`gh issue view <n> --json body`) and check each listed issue with `gh issue view <m> --json state`.
   - The issue is **ready** if it has no blockers or every blocker is CLOSED.
4. **Current work:** note issues labeled `in-progress` or `in-review`, and the current git branch (`git branch --show-current`).
5. **Report** in this format:
   - **Finish first:** anything `in-progress` or `in-review`.
   - **Ready now:** table with columns `#`, `Task`, `Planned`, `Milestone`, sorted by the `Txx` id. Mark `critical-path` ones with ⚡.
   - **Blocked:** table with columns `#`, `Task`, `Waiting on` (the blocking issue number and title).
6. **Recommend one:** if something is in progress, recommend finishing it. Otherwise pick the lowest-numbered ready ⚡ task, or else the lowest-numbered ready task. Explain why in one line.
7. End with: "Start it with `/start-task <n>`."
