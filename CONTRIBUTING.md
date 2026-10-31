# Contributing: how we work

You pick a task from GitHub Issues, hand it to Claude Code, check the result, and ship it. Quality and security checks run automatically at every step.

## One-time setup (~20 min)

**1. Install these** (Windows commands in parentheses):

- Node.js 24 or 26 (the current LTS) with the npm it comes with (11.11 or newer, below 12): https://nodejs.org (`winget install OpenJS.NodeJS.LTS`)
- Git (`winget install Git.Git`)
- GitHub CLI (`winget install --id GitHub.cli`), then run `gh auth login`
- Docker Desktop: https://www.docker.com/products/docker-desktop/. **Windows:** accept the WSL 2 option and restart if asked. Start Docker Desktop and wait for "Engine running".
- VS Code + the **Claude Code** extension (or the `claude` CLI). Sign in with your Claude account.
- **Windows:** after installing anything, close **every** VS Code window and reopen it. Otherwise the new tools aren't on its PATH.
- Accept the GitHub repo invite (email or github.com/notifications). You can't push or be assigned issues without it.

**2. Get the code:**

```bash
gh repo clone jbarra2/teachback
cd teachback
```

**3. Let Claude set it up.** Open the folder in VS Code, open Claude Code, and type **`/setup`**.

It checks your tools, creates `.env` (with a generated auth secret), installs packages, enables the git hooks, starts the two Postgres containers, runs migrations, loads demo data, and runs the checks. If anything's missing, it tells you exactly what to install.

Prefer the terminal? Run `npm run setup`, or `node scripts/setup.mjs` before T01 is merged.

**4. Run it:** `npm run dev` → http://localhost:3000. Demo accounts are in the README. API docs are at http://localhost:3000/api/docs.

Only add `ANTHROPIC_API_KEY` to `.env` (and set `AI_PROVIDER=anthropic`) if your task needs real Claude calls. Everything else uses the free fake AI.

## The task loop

Type these in the Claude Code panel, or in a terminal after `claude`. If a command doesn't show in the panel, use the terminal.

| Step        | You type                                                  | What happens                                                                                                                | Your job                                        |
| ----------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| 1. Pick     | `/next-task`                                              | Lists your ready tasks (all blockers merged) and suggests one                                                               | Choose                                          |
| 2. Start    | `/start-task 23`                                          | Creates branch `23-...`, reads the spec, proposes a plan **with the tests it will write**                                   | Reply `go`, or adjust                           |
| 3. Build    | (conversation)                                            | Writes code + tests together. Hooks check every commit.                                                                     | Answer questions; stop it if it leaves the plan |
| 4. Test     | `/test-task`                                              | Runs `npm run verify` (everything CI runs), audits security and stability coverage, fixes gaps, gives you manual test steps | Do the manual steps in the browser              |
| 5. Security | `/security-review`                                        | Claude Code's built-in security review of your changes                                                                      | Make sure every finding is fixed or explained   |
| 6. Review   | (you)                                                     | –                                                                                                                           | Skim the diff with the checklist below          |
| 7. Ship     | `/finish-task`                                            | Adds your journal entry, final verify, commit, push (pre-push runs checks), PR with test evidence, watches CI               | Pick how to write the journal entry; confirm    |
| 8. Fix      | `/fix-ci` or `/address-review`                            | Fixes red CI or applies review comments                                                                                     | Confirm                                         |
| 9. Merge    | Squash-merge when `ci-ok` + CodeQL are green and approved | The issue closes automatically                                                                                              | `/clear`, then step 1                           |

**Your review checklist (step 6):**

- [ ] Does what the issue asks, and nothing extra.
- [ ] Only my track's folders. No protected files unless the issue says so.
- [ ] Tests cover the happy path, the errors, and the security matrix for any route.
- [ ] No secrets, `.env` or debug leftovers.
- [ ] I tried it myself.
- [ ] I can explain every file in the diff.

**Reviewing a teammate's PR:** `/finish-task` requests both other teammates, and **one approval is enough**; whoever is free first reviews. CODEOWNERS automatically adds the lead for protected areas (contract, schema, security code). Run `/review-pr 31`: Claude drafts a security-focused review, you decide, and Claude posts it. Review within a few hours, because reviews unblock people.

## Your work journal

Everyone keeps `docs/journal/<your-github-username>.md`: one short entry per task with what you built, what you asked Claude for, what you decided or dropped, the hardest part and how you solved it, and what you learned. It's for studying later, the README's Team section, and your resume, and it's also our project log of what changed as we went.

You don't have to remember it. `/finish-task` adds the entry before it commits and asks how you want to answer the two questions:

1. **I'll write my answers**: you type them.
2. **Draft it, I'll edit**: Claude drafts from what actually happened in the session; you fix and approve.
3. **Write it for me**: for when you're short on time. The entry is marked `<!-- needs-review -->`; read it and delete the marker before Sat Nov 7.

Details and the format: `docs/JOURNAL.md`. Only edit your own journal, and never put keys or personal details in it (the repo is public).

## What checks your work, and when

| When         | What                                                                                                    | Details           |
| ------------ | ------------------------------------------------------------------------------------------------------- | ----------------- |
| Every commit | Secret scan, blocked files, format + lint of staged files, commit message format                        | git hooks         |
| Every push   | No pushes to `main`; `npm run check`                                                                    | git hook          |
| End of task  | `npm run verify` + security/stability audit + `/security-review`                                        | `/test-task`      |
| Every PR     | CI (`ci-ok`: lint, types, OpenAPI, unit + integration + coverage, gitleaks, audit, build, e2e) + CodeQL | required to merge |

Full details: `docs/TESTING.md`. If a hook blocks you, it tells you why. Fix it rather than bypassing it.

## Rules of the road

- Only start **Ready** tasks.
- Stay in your folders (PLAN §2).
- The API contract (`openapi/openapi.yaml`), the database schema and the zod schemas belong to the lead. Comment on your issue to request changes.
- Small PRs, one issue each.
- Stuck for more than 1 hour? Post in the group chat.
- **Never** commit `.env` or API keys (the repo is public), push to `main`, force-push, or use `--no-verify`.
- AI attribution lines are removed from commit messages automatically (team convention).

## Schedule

- Weekday evenings + weekend days (PLAN §11). Daily standup in the group chat: _done / next / blocked_.
- **Fri Nov 6, 11:59 PM: feature freeze.** Bug fixes only after that.
- **Sat Nov 7: bug bash, then stop.**

## Claude Pro tips

- `/clear` after each merged task. One task per session.
- If you hit a usage limit, post your issue number + branch in the chat. The lead can pick it up.

## Troubleshooting

| Problem                                               | Fix                                                                                                                         |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Anything setup-related                                | `/setup` again (safe to re-run)                                                                                             |
| "Docker is not running"                               | Start Docker Desktop and wait for "Engine running"                                                                          |
| Port 5433/5434 already in use                         | Another Postgres is running. Stop it, or ask the lead.                                                                      |
| DB errors after pulling                               | `npm run db:update`                                                                                                         |
| CI is red                                             | `/fix-ci`                                                                                                                   |
| Merge conflict                                        | Ask Claude: "merge main into my branch and resolve the conflicts"                                                           |
| Hook says "looks like a secret"                       | Remove it. If it's a false positive, add the comment `gitleaks:allow` on that line (the CI secret scan honours it too).     |
| CI secret scan flags an already-pushed false positive | Add the finding's fingerprint (shown in the gitleaks log) to `.gitleaksignore`. If it's a real secret, **revoke it first**. |
| Conflict in `package-lock.json`                       | `git checkout origin/main -- package-lock.json && npm install`, then commit                                                 |
| `npm error code EBADDEVENGINES`                       | Wrong Node or npm. Install the current Node LTS (`winget install OpenJS.NodeJS.LTS`), check `npm -v` is 11.11+ and below 12 |
| Windows: hook error mentioning `\r`                   | Run `npm install` (it normalizes hook line endings)                                                                         |
