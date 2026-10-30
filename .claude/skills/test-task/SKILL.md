---
name: test-task
description: Verify the current task thoroughly. Full verify gate, security-matrix and stability audit, self-review against team rules, and manual test steps.
disable-model-invocation: true
allowed-tools: Bash(git fetch:*), Bash(npm run verify:*), Bash(npm run check), Bash(npm run lint), Bash(npm run typecheck), Bash(npm run test:*), Bash(npm run api:*), Bash(npm run audit), Bash(npm run build), Bash(npm run db:up), Bash(npm run db:update), Bash(docker compose ps:*), Bash(git status:*), Bash(git diff:*), Bash(git log:*), Bash(git branch:*), Bash(gh issue view:*)
---

Verify the task on the current branch. Be strict: this is the main quality and security gate before a PR.

## 1. Context

- Issue number = leading number of `git branch --show-current`. Read it with `gh issue view <n> --json title,body,labels`.
- `git fetch origin`, then changed files: `git diff --name-only origin/main...HEAD` plus `git status`.

## 2. Full gate

- Run `npm run verify` (mirrors CI). If a step fails because the DB is down: `npm run db:up`, then retry.
- Fix failures caused by this branch and tell me what you changed. If something also fails on `main`, report it and don't fix it here.

## 3. Security matrix audit (docs/TESTING.md §3)

For every API route this branch adds or changes, build a table:

| Route | S1  | S2  | S3  | S4  | S5  | S6  | S7  | S8  | S9  |
| ----- | --- | --- | --- | --- | --- | --- | --- | --- | --- |

Mark each cell ✅ (test exists, name it), n/a (doesn't apply, with the reason) or ❌. **Write the missing tests**, run them, and update the table. Uploads also need the extra cases listed under §3.

## 4. Stability audit (docs/TESTING.md §6)

Check what applies:

- AI failure modes tested
- transactions for multi-write operations
- no stuck states
- limits enforced server + client
- no floating promises
- UI loading/error/empty states
- polling cleanup
- double-submit prevention

Add the missing tests or fixes.

## 5. Self-review of the diff

For each acceptance criterion: ✅ verified (how), 🟡 needs my manual check, or ❌ not done → fix.

Then check the rules:

- only my track's folders
- no protected files unless the issue allows
- routes wrapped in `withApi`
- queries scoped to the user
- no Prisma in handlers or components
- user text rendered as text
- no secrets or `.env`
- no sensitive logging
- no `eslint-disable`/`@ts-ignore`/`any`/skipped tests
- `openapi.yaml` matches the behaviour
- new dependencies meet TESTING §5

Fix violations; ask first if a fix is big.

Re-run `npm run verify` if you changed anything.

## 6. Manual test steps for me

Exact steps: `npm run dev`, the URL, what to click or type, and what to expect. Include 1–3 relevant **abuse checks** from TESTING §7 (e.g. open demo user A's URL while signed in as demo user B). For APIs, give the curl command or browser devtools steps. Say whether `AI_PROVIDER=anthropic` is needed (default `fake`).

## 7. Report

- The verify summary table.
- The security matrix table.
- The acceptance criteria table.
- Open items.

End with: "Next: do the manual steps, then run **`/security-review`** and fix any findings, then `/finish-task`."
