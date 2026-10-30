---
name: finish-task
description: Finish the current task. Journal entry, final verify, commit, push, open a PR with test evidence that closes the issue, request review and watch CI.
disable-model-invocation: true
allowed-tools: Bash(npm run verify:*), Bash(git status:*), Bash(git diff:*), Bash(git log:*), Bash(git branch:*), Bash(git fetch:*), Bash(git merge:*), Bash(gh api user:*), Bash(gh issue view:*), Bash(gh pr view:*), Bash(gh pr checks:*), Edit(docs/journal/**), Write(docs/journal/**)
---

Ship the task on the current branch.

1. **Issue:** take the number from `git branch --show-current`, then `gh issue view <n> --json title,labels`. Never ship from `main`.
2. **Security review gate:** ask me "Did you run `/security-review` on these changes, and are all findings fixed or explained?" If not, stop and tell me to run it first.
3. **Journal entry** (format and rules: `docs/JOURNAL.md`):
   - My file is `docs/journal/<login>.md` (`gh api user --jq .login`). If it doesn't exist, create it with the header from `docs/JOURNAL.md`: my name (`gh api user --jq .name`; ask me if it's empty) and my role (the key in `.github/team.json` whose value is my login: `lead` → Lead, `ai` → AI, `frontend` → Frontend; ask me if I'm not listed).
   - If it already has an entry for `#<n>` (from an earlier run), show it and ask whether to keep it or redo it. Otherwise:
   - Fill in the facts yourself: heading `## Txx · <title> (#<n>) · <today, e.g. Oct 30, 2026>`, **What I built** and **Skills & tools**, from the issue, `git diff origin/main --stat` plus `git status` (the work isn't all committed yet), and the main files.
   - Ask me how to answer the two questions (multiple choice):
     1. **I'll write my answers**: ask "What was the hardest part, and how did you solve it?" and "What did you learn?". Save my words as written; only fix obvious typos.
     2. **Draft it, I'll edit**: draft both answers, show me the whole entry, apply my edits, and wait for my OK.
     3. **Write it for me**: write both answers, put `<!-- needs-review -->` on the line under the heading, and show me the entry. Don't wait; step 4 is my chance to change it.
   - **Drafting rules (options 2 and 3):**
     - First person, my voice, plain and specific. 2–4 sentences per answer.
     - Base it on what actually happened in this conversation: the plan, errors and failed tests, how they were fixed, decisions I made or corrected. Use the diff and commits for the rest.
     - Never invent problems, lessons, numbers or outcomes. If this conversation has little history (for example after `/clear`), say less, and pick the trickiest decision visible in the diff as the "hardest part".
     - Describe the engineering problem and the fix. Prefer lessons I was involved in and could explain in an interview.
     - Public repo: no keys, `.env` values, passwords, personal details, or quotes from private chats.
   - Append the entry at the end of the file.
4. **Confirm:** show `git status` and a short summary of the changes. Ask: "Commit, sync with main, verify, push and open the PR?" Wait for yes.
5. **Commit first:**
   - Stage only this task's files plus my journal file (never `.env`).
   - Conventional message `<type>(<scope>): <summary> (#<n>)`.
   - **No AI attribution lines.**
   - The hooks run the secret scan, lint/format and message checks. If one blocks, fix the cause. Never use `--no-verify`.
6. **Sync:** `git fetch origin && git merge origin/main`. Resolve conflicts keeping both sides' intent; ask if unsure. For `package-lock.json` conflicts: `git checkout origin/main -- package-lock.json && npm install`, then commit.
7. **Final gate:** `npm run verify` must pass on the merged result. Keep its summary table for the PR. If it fails, fix, commit and re-run, or stop.
8. **Push:** `git push -u origin HEAD` (pre-push runs `npm run check`).
9. **Open the PR.** Title = the issue title. Body = `.github/pull_request_template.md`, filled in completely:
   - `Closes #<n>`
   - what changed
   - how to test (the manual steps from `/test-task`)
   - **Test evidence:** the verify summary, coverage %, and the security matrix table
   - **Security:** the `/security-review` result and how each finding was handled
   - new packages
   - the checklist, ticked honestly
   - no AI footer

   Reviewers: read `.github/team.json`, drop my own login (`gh api user --jq .login`), and request the other two. One approval is enough; CODEOWNERS adds the lead automatically for protected areas. Run `gh pr create --base main --title "<title>" --body-file - --reviewer <user>,<user>` with the body on stdin.

10. **Labels:** `gh issue edit <n> --remove-label in-progress --add-label in-review`.
11. **CI:** `gh pr checks --watch`. If `ci-ok` or CodeQL fails, do the `/fix-ci` steps.
12. **Report:** the PR URL and check status. If the journal entry has `<!-- needs-review -->`, remind me to read it before Saturday. Then: "Ping your reviewer. After approval + green checks, squash-merge, then `/clear` and `/next-task`."
