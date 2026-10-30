# TeachBack: instructions for Claude Code

TeachBack is a Next.js app where students upload lecture notes, explain concepts in their own words, get feedback grounded in their notes (Claude API), and see a concept map of what to review. It's a 3-person team project in a **public** repo. **Code freeze: Sat Nov 7, 2026.**

- Spec: `docs/PLAN.md`. Testing & security: `docs/TESTING.md`. Human workflow: `CONTRIBUTING.md`.
- Read only the sections your issue references (its "Spec" line) plus PLAN §2 and §4. Don't load whole files you don't need.
- Every piece of work is a GitHub issue titled `Txx · ...`.

## Team commands

| Command            | What it does                                                                                              |
| ------------------ | --------------------------------------------------------------------------------------------------------- |
| `/setup`           | First-time (or repair) setup of this machine: prerequisites, `.env`, Docker DBs, migrations, seed, checks |
| `/next-task`       | Show my assigned issues that are ready (all blockers closed) and suggest one                              |
| `/start-task <n>`  | Check it's ready, create the linked branch, read the spec, propose a plan with tests, build after "go"    |
| `/test-task`       | `npm run verify`, security-matrix and stability audit, self-review, manual test steps                     |
| `/security-review` | Built into Claude Code: security review of the branch's changes (run after `/test-task`)                  |
| `/finish-task`     | Final verify, commit, push, open the PR with test evidence, watch CI                                      |
| `/fix-ci`          | Diagnose and fix a failing CI run on my PR                                                                |
| `/review-pr <n>`   | Security-focused review of a teammate's PR; draft comments for the human to post                          |
| `/address-review`  | Apply the review feedback on my PR                                                                        |

If someone says "work on #n" without a command, follow `.claude/skills/start-task/SKILL.md` anyway.

## Hard rules

1. **One issue = one branch = one PR.** Do what the acceptance criteria say, nothing more. No drive-by refactors. Note follow-ups in the PR.
2. **Ownership** (PLAN §2): only edit folders owned by the issue's track (label `lead`, `ai` or `frontend`), plus the shared `package.json`/`package-lock.json` and any exception the issue grants. Need a change elsewhere? Stop and say who to ask.
3. **Protected files:** `openapi/openapi.yaml`, `prisma/schema.prisma`, `prisma/migrations/**` and `src/lib/schemas/**` are changed only by lead-track issues, or when the issue explicitly says so.
4. **Plan before code** when more than one file changes. The plan lists the tests, including the security matrix rows. Wait for "go".
5. **Tests are part of the task** (TESTING §1):
   - Write them with the code.
   - Every API route gets the security matrix (TESTING §3).
   - Every bug fix gets a regression test.
   - **Never** skip or weaken tests, lower coverage thresholds, add `eslint-disable`/`@ts-ignore`/`any`, or use `--no-verify` to get green. If you think one is truly necessary, stop and ask.
6. **Done means `npm run verify` passes.** UI work is also checked in the browser by the human (give them steps).
7. **Git:**
   - Branch with `gh issue develop <n> --checkout`.
   - Conventional commits ending in `(#n)`.
   - Never commit to or push `main`, never force-push, never rewrite pushed history.
   - **Never add `Co-Authored-By`, `Claude-Session`, "Generated with Claude Code", or any AI attribution to commits or PR text.**
8. **Secrets:** never read, print or commit `.env`. New variables go in `.env.example` (placeholder values) and `.env.test` (dummy values). This repo is public.
9. **Database:**
   - Never run `prisma migrate reset`, `db push --force-reset`, or anything that drops data.
   - Never touch the `db` container's volume.
   - Only lead-track issues create migrations. Everyone else runs `npm run db:update`.
10. **Dependencies:** follow TESTING §5. Justify each new package and list it in the PR.
11. **Check current APIs.** Next.js 16, Prisma 7, Better Auth, `@anthropic-ai/sdk`, zod v4, Scalar and openapi-fetch change often. Read the installed version's types and README in `node_modules` before writing integration code.
12. **Ask instead of guessing.** Keep explanations short.
13. **Usage budget:** teammates are on Claude Pro. Avoid reading big files you don't need, trim logs to the errors, and suggest `/clear` after a task is merged.

## Security & code conventions (details in PLAN §4, TESTING §8)

- **Every route is wrapped in `withApi()`** (auth, Origin check, body limit, rate limit, safe errors). Handlers: zod-parse (`.strict()`) → call **one** service → return contract-shaped JSON.
- **Testable handlers:** API code reads everything from the `Request`. Never use `next/headers`/`cookies()` there. Background work goes through `runAfterResponse()` (`src/lib/api/background.ts`), never `after()` directly.
- **Ownership:** scope every query to the session user. Another user's resource returns 404.
- **No Prisma in components or route handlers.** Services own data access. `import { db } from "@/lib/db"`. Never use `$queryRawUnsafe`/`$executeRawUnsafe`.
- **API changes:** `openapi/openapi.yaml` changes first (lead), then `npm run api:types`. Integration tests validate responses with `expectMatchesOpenApi`.
- **Claude calls** only through `src/lib/ai/provider.ts`. Notes and answers are wrapped as untrusted data. Model output is never executed or rendered as HTML.
- **Rendering:** user text is rendered as text. Never use `dangerouslySetInnerHTML`. Server components by default; `"use client"` only for interactive parts.
- **Logging** only via `src/lib/log.ts`. Never log secrets, cookies, note text or answers.
- **Limits** (PLAN §7) are enforced on the server and mirrored in the UI.
- **Next 16:** `params` is a Promise (`const { id } = await params`). Interception lives in `src/proxy.ts`. Don't enable `cacheComponents`.
- **Tests:** unit `*.test.ts(x)` next to the code; integration `*.int.test.ts` (uses the `db-test` DB); e2e in `tests/e2e/`.

## Commands

| Script                                                                | Purpose                                                           |
| --------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `npm run setup`                                                       | One-command setup (safe to re-run)                                |
| `npm run dev`                                                         | App on http://localhost:3000. API docs at `/api/docs`             |
| `npm run verify`                                                      | **Full gate, mirrors CI.** Must pass before a PR                  |
| `npm run check`                                                       | Fast: format + lint + typecheck + unit tests (pre-push runs this) |
| `npm run test -- <pattern>` / `npm run test:int` / `npm run test:e2e` | Test suites                                                       |
| `npm run api:lint` / `npm run api:types`                              | Lint the OpenAPI spec / regenerate client types                   |
| `npm run db:up` / `npm run db:update` / `npm run db:seed`             | Start DBs / apply migrations / demo data                          |
| `npm run ai:ping`                                                     | One real Claude API call to test a key                            |

Until T01 is merged there's no `package.json`. Only `/setup` (partial), T01 and `node scripts/setup-github.mjs` apply.
