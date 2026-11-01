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

## T36 · One Node and npm version for the team and CI (#39) · Oct 31, 2026

<!-- needs-review -->

**What I built:** A toolchain pin so every machine and CI write `package-lock.json` the same way. `devEngines` in `package.json` makes npm refuse Node below 24 or npm outside 11.11–11.x, CI moved from Node 22 to 24, and `scripts/setup.mjs` checks both versions up front with an install hint.

**Skills & tools:** npm `devEngines`, GitHub Actions (`actions/setup-node`), Node.js, Vitest config tests, mutation testing

**Asked Claude for:** How to answer a teammate's T04 questions (a `task` parameter on `generateJson`, lockfile noise from npm 10, and a new env var), then to standardize the team on Node 24 with npm 11 and ship the fix quickly so the teammate could keep working.

**Decided / dropped:**

- Pinned npm to 11.11 or newer, below 12, instead of "any npm 11": npm 10 and npm 11 below 11.11 drop the lockfile's `libc` fields, so the major version alone wasn't enough.
- Left npm 12 out until it's tested.
- Used `devEngines` with `onFail: "error"` so npm itself enforces the range, not just the setup script or the docs.
- Dropped my first conclusion that the lockfile matched npm 12. It came from `--package-lock-only`, which adds entries on every npm 11; a real install with npm 11.11 left the file unchanged.

**Hardest part, and how I solved it:**
Working out which npm versions actually rewrite the lockfile. I regenerated a copy with about a dozen npm versions and compared the diffs, which showed the boundary at 11.11. The comparison method itself added noise, so I confirmed the result with a real install before trusting it.

**What I learned:**
The lockfile format depends on the npm minor version, not just the major, so a team needs a pinned range that the tool enforces itself. With `devEngines`, npm stops `install` and `run` with EBADDEVENGINES on a wrong version, so the check lives in one place instead of in every script.

## T37 · Merge on green CI; lead reviews risky PRs (#41) · Oct 31, 2026

<!-- needs-review -->

**What I built:** Merging to main no longer needs an approval: a PR merges once `ci-ok` and CodeQL are green, and a teammate's risky PR (another track's files, CI files, new packages, routes, auth, data access, uploads, the Claude provider) waits for my review. To make that safe I moved the ruleset into `scripts/protect-main-ruleset.json` with a live-drift check (`setup-github.mjs --check-protect`), added a plain-Node dependency check (`scripts/lockfile-check.mjs`) that CI runs before any install script, and added tests that pin `ci.yml` and keep every HTTP entry point under `src/app/api/`.

**Skills & tools:** GitHub rulesets and required checks, GitHub Actions, npm lockfiles and install scripts, Next.js entry points, Vitest, mutation testing, security review

**Asked Claude for:** Whether required PR approvals were worth the wait for a three-person team, then to drop them and keep main safe without them, with review rounds until the findings ran out of High and Medium issues.

**Decided / dropped:**

- Dropped required approvals but kept the PR requirement, `ci-ok` and CodeQL. My review of teammates' risky PRs is a team rule that `/finish-task` applies, not a GitHub gate, so my own PRs never wait.
- Pinned `ci-ok` to the GitHub Actions app, so a hand-posted status can't pass as CI.
- Checked dependencies with plain Node before `npm ci`, after a review showed that running the check with Vitest let the lockfile replace Vitest itself.
- Dropped the idea of enforcing the rule with code-owner review: it would have blocked my own PRs or needed a bypass click every time.

**Hardest part, and how I solved it:**
Each review round found a new way around the newest guard: the lockfile check could be fooled by an uppercase `.TGZ`, by an entry nothing depended on, or by the very packages it was checking. I fixed each one with a test first and proved it by breaking the code on purpose, and I stopped when a round found only small, deliberate-tampering issues.

**What I learned:**
Without a human approval, every protection has to be something a machine checks, and CI runs whatever the PR says, so the check must not depend on code the PR can change. npm installs whatever a lockfile's `resolved` URL points at as long as the hash matches, which is why a lockfile needs its own check.

## T03 · API contract: openapi.yaml + Scalar docs + zod schemas + client types (#3) · Nov 1, 2026

**What I built:** The API contract every other track builds against: `openapi/openapi.yaml` with all 13 operations, the PLAN §7 limits, error codes and examples; zod request schemas in `src/lib/schemas/`; client types generated from the spec (`npm run api:types`, with a `--check` mode for CI); and `/api/openapi` and `/api/docs` (Scalar), which are off unless `API_DOCS_ENABLED` is set. Contract tests read PLAN and TESTING and fail if the spec, the schemas or the limits drift from them.

**Skills & tools:** OpenAPI 3.1 and JSON Schema, Redocly CLI, openapi-typescript, zod 4, Scalar, Subresource Integrity, Next.js route handlers, Vitest, mutation testing, security review

**Asked Claude for:** To build the contract in line with PLAN §7 and the T04 provider so the frontend and AI tracks could start, with a plan and tests first and screenshots of the docs page while I was away from my laptop. At the end I asked for tests to be written before the code from now on, since the reviews kept finding missing ones.

**Decided / dropped:**

- Pinned Scalar's browser script to one release with an integrity hash, and turned off its telemetry, AI agent, MCP and developer toolbar, so the docs page loads nothing unpinned.
- Kept the docs routes off by default: they're public by design but only useful in development.
- Typed the upload's file field with `contentMediaType` instead of `format: binary`, so T07's strict validator compiles every schema, and generated it as `Blob` in the client types.
- Counted text limits in characters (code points), trimmed, and rejected NUL and broken surrogate pairs. An empty form field counts as not sent, because a browser sends an empty file part when no file is chosen.
- Updated PLAN §7 and §8 where the contract needed it: an optional `error` on documents, at least one source per question, and non-empty evidence quotes with a label the server adds.
- Dropped a `oneOf` on the upload body (the strict validator rejects it) for zod checks plus a description, and dropped `String#isWellFormed` for a regex because older browsers lack it.

**Hardest part, and how I solved it:**
Making the docs page safe to serve from our own origin. Scalar loads its browser script from a CDN, takes the latest release by default, and has no integrity option. I pinned one release, added its SRI hash to the page, and made the route return a 500 unless that bundle is the only outside URL on the page, after reviews showed other ways a script could load unchecked (a protocol-relative URL, a CSS `url()`, a dynamic import). A real-browser test confirmed that with the hash one character off, the browser refuses the script.

**What I learned:**
Tests that read their cases from the spec itself (every limit, error code and example) catch drift between the spec, the plan and the zod schemas that hand-picked cases miss. Each review round still found a missing test, so I now write the tests before the code and let the reviews look for what's left. I also learned that a tool can pass and still crash: Redocly's update check aborted on Windows after a clean lint, and turning it off in a wrapper script fixed it.
