# Work journal: Jonathan Barragan (@jbarra2)

**Role:** Lead on TeachBack, a Next.js app that grades students' explanations against their own notes.

One entry per task, oldest first.

## T01 · Scaffold Next.js app & tooling (#1) · Oct 30, 2026

<!-- needs-review -->

**What I built:** The Next.js 16 app scaffolded into our existing repo, plus the quality gate everyone builds on: an ESLint flat config that enforces our security and layering rules (no database access from pages or components, the Claude SDK only in `src/lib/ai`, no raw SQL, `eval` or raw HTML, no `eslint-disable`), Vitest with a Node project and a jsdom project, Prettier, the npm scripts, and the folder skeleton. I also hardened the pre-commit secret scan and `.gitignore`, added a script that fails the test run if any test file stops being collected, and made the dev and production servers listen only on localhost.

**Skills & tools:** Next.js 16, TypeScript, ESLint 9 flat config with typed linting (typescript-eslint), Vitest 5, Testing Library, jsdom, Prettier, git hooks, gitleaks, Docker, GitHub Actions, mutation testing

**Asked Claude for:** Build T01 from the issue, then add one thing beyond it: switch off inline `eslint-disable` comments so every exception has to be made in the reviewed config. I also had it run independent security and test-quality reviews, repeated until they came back clean, and asked it to check whether our per-person journals already cover the project log we need.

**Decided / dropped:**

- Stayed on TypeScript 5 and ESLint 9: typed linting doesn't support TypeScript 7 yet, and Next's lint plugins don't support ESLint 10.
- Used jsdom 29, because 30 needs a newer Node than most of us run.
- Both local servers listen on localhost only, with a documented one-time override for phone testing. Turned off Next's dev-only MCP endpoint, which would otherwise answer anyone on the same Wi-Fi.
- The CI secret scan now covers the env templates too, after a test showed the old exemption hid a pasted key.
- Dropped a separate LOG.md: the journals plus two new fields (this one and "Asked Claude for") cover it.
- First chose to commit the AGENTS.md file that `next dev` generates, then reversed that and turned it off, so CLAUDE.md stays the one place for agent instructions.

**Hardest part, and how I solved it:**
Proving the protections actually work, not just that tests pass. We broke each rule on purpose, one at a time, and checked that a test failed every time (128 of 128 now do). That process found real bugs:

- The pre-commit hook let a remote database URL through when the host merely started with `db.`, because the regex used `\b`.
- The hook skipped files PowerShell saves as UTF-16.
- A single `.cjs` file would have crashed the whole lint run.

**What I learned:**
A passing test only counts as evidence if it fails when the code is wrong, and mutation testing is a cheap way to check that. Small details decide whether a security check holds: `\b` matches before a dot, Windows tools can write UTF-16, and Next serves `.js` route files, so lint bans have to cover every file type. I'd use the break-it-on-purpose approach again for any guard that protects secrets or data.

## T35 · Team onboarding: logins, CODEOWNERS and journal fields (#37) · Oct 30, 2026

<!-- needs-review -->

**What I built:** The repo setup our teammates need before they start.

- Their GitHub logins in `.github/team.json` and `CODEOWNERS`, which decide issue assignment and review requests. `CODEOWNERS` now also covers the lead-owned config.
- Two new journal fields so these entries double as our project log.
- Tests that keep AI attribution out of git history: the commit-msg hook's stripping and its Conventional Commits check, plus Claude Code's attribution settings.

**Skills & tools:** GitHub CODEOWNERS, git hooks, Vitest, Claude Code settings, mutation testing

**Asked Claude for:** Add the teammates' logins so I could invite them. I also asked it to make sure AI attribution never shows up in our git history, and to add the two journal fields we agreed on in T01.

**Decided / dropped:**

- Turned off Claude Code's session links (`sessionUrl: false`). Remote Control sessions would otherwise add one to commits and PRs.
- Tightened the commit-msg hook so only messages git writes itself skip the format check. Before, any subject starting with "Merge" or "Revert" passed.
- Kept the teammates' logins out of PR text as @mentions, so nobody got notified before the kickoff message.

**Hardest part, and how I solved it:**
Making the protections testable without depending on GitHub. The commit-msg hook had no tests at all, and the login check only caught leftover placeholders. A review pointed out that swapping two roles would still pass. I added tests that map every CODEOWNERS path to its track's owner, and checked each one by breaking it on purpose.

**What I learned:**
CODEOWNERS only works for people who already have write access, so the order is: invite, they accept, then assign issues. A guard like "skip validation for merge commits" needs to match exactly what git writes, or it quietly lets through messages that merely start the same way.
