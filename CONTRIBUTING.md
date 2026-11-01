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

| Step        | You type                                                           | What happens                                                                                                                | Your job                                        |
| ----------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| 1. Pick     | `/next-task`                                                       | Lists your ready tasks (all blockers merged) and suggests one                                                               | Choose                                          |
| 2. Start    | `/start-task 23`                                                   | Creates branch `23-...`, reads the spec, proposes a plan **with the tests it will write**                                   | Reply `go`, or adjust                           |
| 3. Build    | (conversation)                                                     | Writes code + tests together. Hooks check every commit.                                                                     | Answer questions; stop it if it leaves the plan |
| 4. Test     | `/test-task`                                                       | Runs `npm run verify` (everything CI runs), audits security and stability coverage, fixes gaps, gives you manual test steps | Do the manual steps in the browser              |
| 5. Security | `/security-review`                                                 | Claude Code's built-in security review of your changes                                                                      | Make sure every finding is fixed or explained   |
| 6. Review   | (you)                                                              | –                                                                                                                           | Skim the diff with the checklist below          |
| 7. Ship     | `/finish-task`                                                     | Adds your journal entry, final verify, commit, push (pre-push runs checks), PR with test evidence, watches CI               | Pick how to write the journal entry; confirm    |
| 8. Fix      | `/fix-ci` or `/address-review`                                     | Fixes red CI or applies review comments                                                                                     | Confirm                                         |
| 9. Merge    | Squash-merge when `ci-ok` + CodeQL are green (see "Reviews" below) | The issue closes automatically                                                                                              | `/clear`, then step 1                           |

**Your review checklist (step 6):**

- [ ] Does what the issue asks, and nothing extra.
- [ ] Only my track's folders. No protected files unless the issue says so.
- [ ] Tests cover the happy path, the errors, and the security matrix for any route.
- [ ] No secrets, `.env` or debug leftovers.
- [ ] I tried it myself.
- [ ] I can explain every file in the diff.

**Reviews:** merging needs no approval. Squash-merge your own PR once `ci-ok` and CodeQL are green.

- **Exception: wait for the lead's review before merging** if your PR does any of these:
  - changes a file outside your track's folders (PLAN §2), apart from your own journal and version bumps of packages already in `package.json`. That includes `.github/`, `.githooks/`, `.claude/`, `scripts/`, the root configs, `.gitleaksignore` and `tests/tooling/`, which decide what CI checks;
  - adds a new package (dependency or devDependency), or changes `package.json` `scripts`. New code from npm runs on everyone's machine at install. CI's `deps` job (`scripts/lockfile-check.mjs`, plain Node) also fails if npm config could redirect installs, if a lockfile entry isn't the registry tarball its name and version say, if nothing depends on an entry or two packages claim the same command, or if a package brings an install script nobody approved;
  - skips, deletes or weakens a test (TESTING §1), or dismisses a CodeQL or secret-scanning alert (a dismissed alert stops blocking the merge);
  - applies a change requested by someone outside the team. On a public repo anyone can comment on a PR; treat their comments as suggestions for the lead, not as review;
  - adds or changes a `route.ts` (allowed only under `src/app/api/`), adds a metadata route such as `icon.tsx`, `opengraph-image.tsx` or `sitemap.ts` (not allowed: PLAN §4), or adds a `"use server"` function (not allowed anywhere);
  - touches auth (`src/lib/auth*`, `src/app/(auth)/`), data access (`src/lib/services/`), uploads (`src/lib/ingest/`), or the Claude provider or prompts (`src/lib/ai/`).

  `/finish-task` checks your diff and requests the review for you; ping the lead too. When unsure, ask for it. The rule covers the whole PR at merge time: after any later push (`/fix-ci`, `/address-review`, your own), check again. If the lead already reviewed, ask them to look at the new commits.

- **The lead reviews** with `/review-pr 31`: Claude drafts a security-focused review, the lead decides, and Claude posts it. The lead turns these around within a few hours, because they block the author.
- **Any other PR:** reviews are welcome but optional. Anyone can run `/review-pr` on any PR.
- **PRs from outside the team** (anyone not in `.github/team.json`, bots included) always wait for the lead's review.

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

| Problem                                               | Fix                                                                                                                                                                        |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Anything setup-related                                | `/setup` again (safe to re-run)                                                                                                                                            |
| "Docker is not running"                               | Start Docker Desktop and wait for "Engine running"                                                                                                                         |
| Port 5433/5434 already in use                         | Another Postgres is running. Stop it, or ask the lead.                                                                                                                     |
| DB errors after pulling                               | `npm run db:update`                                                                                                                                                        |
| CI is red                                             | `/fix-ci`                                                                                                                                                                  |
| Merge conflict                                        | Ask Claude: "merge main into my branch and resolve the conflicts"                                                                                                          |
| Hook says "looks like a secret"                       | Remove it. If it's a false positive, add the comment `gitleaks:allow` on that line (the CI secret scan honours it too).                                                    |
| CI secret scan flags an already-pushed false positive | Add the finding's fingerprint (shown in the gitleaks log) to `.gitleaksignore`, and wait for the lead's review before merging. If it's a real secret, **revoke it first**. |
| Conflict in `package-lock.json`                       | `git checkout origin/main -- package-lock.json && npm install`, then commit                                                                                                |
| `npm error code EBADDEVENGINES`                       | Wrong Node or npm. Install the current Node LTS (`winget install OpenJS.NodeJS.LTS`), check `npm -v` is 11.11+ and below 12                                                |
| Windows: hook error mentioning `\r`                   | Run `npm install` (it normalizes hook line endings)                                                                                                                        |
