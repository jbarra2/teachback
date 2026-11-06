# Work journal: Jonathan Barragan (@jbarra2)

**Role:** Lead on TeachBack, a Next.js app that grades students' explanations against their own notes.

One entry per task, oldest first.

## T01 · Scaffold Next.js app & tooling (#1) · Oct 30, 2026

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

## T39 · Fix code scanning alerts: pin gitleaks-action, create .env in one step (#47) · Nov 1, 2026

**What I built:** The fix for the three open CodeQL alerts. CI now pins `gitleaks/gitleaks-action` to the v3.0.0 commit SHA, and a test fails if any action from outside GitHub isn't pinned to a full SHA. `scripts/setup.mjs` opens `.env` once and does every read, chmod and write through that handle, so nothing can swap the file between a check and a write. A new or older `.env` ends up readable by its owner only on macOS and Linux, and each failure (a folder or device at `.env`, a read-only file, a full disk, a refused chmod) stops setup with a clear message. `tests/tooling/setup-env.test.ts` runs a copy of the real script with stub commands and a preload that makes file calls fail on purpose.

**Skills & tools:** GitHub Actions, CodeQL (`js/file-system-race`, `actions/unpinned-tag`), Node file descriptors and open flags, POSIX file modes, Vitest, mutation testing, Docker for Linux test runs, security review

**Asked Claude for:** The small PR for the three code scanning alerts once T03 merged, with the tests written before the code. I chose v3.0.0 of the action over the v2.3.9 that `@v2` pointed to, and chose to keep a read-only `.env` as a hard stop.

**Decided / dropped:**

- Pinned v3.0.0 rather than v2.3.9: same inputs, but built for Node 24. I checked the SHA is the commit the upstream tag points to, not a commit from a fork.
- Pinned only third-party actions. GitHub's own `actions/*` stay on version tags, which CodeQL trusts.
- Dropped my first fix (create with `wx`, otherwise open with `r+`). A review of CodeQL's query source showed that two opens of one path count as a check and a use, so it would have raised a new alert. One `O_RDWR | O_CREAT` open replaced it, and an empty `.env` now counts as new.
- A refused chmod stops setup instead of warning, so the secret never goes into a file someone else owns. A chmod the disk ignores (WSL's `/mnt/c`) only warns.
- Kept a complete read-only `.env` as a stop with a "make it writable" hint, because letting it pass needs a second open of `.env`.

**Hardest part, and how I solved it:**
CodeQL kept flagging code where I didn't expect it. My first fix still opened `.env` twice, and once that was gone, the PR's scan flagged a stat followed by a read in a test file. I fixed both by naming `.env` in exactly one open call and doing everything else through the file handle, added a test that pins that, and confirmed it with the PR's CodeQL run: "No new alerts".

**What I learned:**
Static analysis rules match code patterns, so the fix that satisfies them is a structural one (one handle, no second lookup of the path), and test files count too. Some guarantees only show on one platform: Windows ignores Unix file modes and even opens folders, so I ran the Linux-only tests and mutations in a throwaway Docker container as a normal user instead of trusting a skipped test.

## T02 · Database: Docker Postgres + Prisma 7 + Better Auth models + schema (#2) · Nov 2, 2026

**What I built:** The database layer the other tracks build on.

- `prisma/schema.prisma`, with the Better Auth models and the PLAN §6 domain models, and the first migration.
- The Prisma 7 client with the `pg` driver adapter in `src/lib/db.ts`, and `prisma.config.ts`.
- A minimal Better Auth setup in `src/lib/auth.ts`, which refuses a missing, placeholder, public or short secret (`src/lib/auth-secret.ts`).
- A CI step that fails when the migrations and the schema drift apart.
- New lint bans on the Prisma helpers that put raw strings into SQL.
- Tests that check the schema's columns, limits, cascades and enums against PLAN, `openapi.yaml` and Better Auth's own field list.

**Skills & tools:** PostgreSQL, Docker Compose, Prisma 7 (driver adapters, `migrate diff`, shadow databases), Better Auth, ESLint selectors, GitHub Actions, npm install-script allowlists, Vitest, mutation testing, security review

**Asked Claude for:** Build T02 from the issue, with the plan shown and the tests written before the code. Partway through, I had it add the CI drift check and close the lint gaps the security review found instead of deferring them, run the manual test steps for me, and fix security concerns as they come up while recording the rest for later.

**Decided / dropped:**

- Generated the auth models with a one-off run of Better Auth's CLI instead of adding it as a dependency. The old `@better-auth/cli` package is deprecated, so we used its replacement, `auth`.
- Turned on the Prisma adapter's `transaction: true`. Without it, Better Auth's sign-up writes the user and the account separately. A live test left a user with no password when the second write failed, and none with the fix.
- Refused `BETTER_AUTH_SECRETS` and Better Auth's public default secret. Outside production, Better Auth quietly falls back to that default, and the rotation list overrides the configured secret.
- Ran the drift check only in CI. It needs a shadow database, and run locally it would write into a teammate's test database.
- Turned off the Prisma CLI's update check (`CHECKPOINT_DISABLE=1`). Its background process contacted Prisma's servers and kept temp folders locked during tests.
- Ran the live database checks by hand for now. T07 turns them into committed tests.

**Hardest part, and how I solved it:**
Making sure the schema can't drift silently from what Better Auth expects, from the migration, or from our API contract. The tests compare it to Better Auth's field list, to the enums in `openapi.yaml` and to the PLAN limits, and CI diffs the migrations against the schema. Breaking things on purpose showed a gap: Better Auth's own schema check can't tell whether a column is required, so making a user column optional went unnoticed. I fixed it with a test that generates the SQL from the schema and checks every required column, and after that all 87 mutations were caught.

**What I learned:**
A library's defaults can be unsafe for our app even when its docs look fine, so I read the installed source. That's how I found Better Auth's public fallback secret and the sign-up that isn't atomic without `transaction: true`. Prisma 7 also changed a lot from earlier versions: it no longer reads `.env` itself, the database URL moved to `prisma.config.ts`, and the client is generated into our own source folder.

## T06 · Auth + secure API route wrapper (withApi) (#6) · Nov 2, 2026

**What I built:** Real accounts and the wrapper every API route uses.

- `withApi()` in `src/lib/api/` handles the cross-cutting checks:
  - the session check, from the request's own headers;
  - the cross-site Origin check;
  - body limits, checked against Content-Length and again while reading;
  - zod errors as 400s;
  - generic 500s with a request id.
- Better Auth is mounted at `/api/auth/*`, but only for the four endpoints the app uses:
  - bodies are checked with strict schemas;
  - tokens are stripped from responses;
  - rate limiting is stored in a new `rateLimit` table.
- Around them:
  - `src/proxy.ts` sends signed-out visitors to `/login?next=…`;
  - `src/lib/auth-client.ts` is for T15's forms;
  - `runAfterResponse` handles background work;
  - a small safe logger;
  - per-request checks that refuse unsafe production settings.

**Skills & tools:** Next.js 16 route handlers and proxy, Better Auth, Prisma 7 migrations, zod 4, Vitest with Better Auth's in-memory adapter, Docker PostgreSQL for live checks, threat modelling, mutation testing, security and test reviews

**Asked Claude for:** Handle the open PRs first, then build T06 from a plan with a threat model and tests written first. Partway through, I chose to hide account existence at sign-up, and asked for security concerns to be fixed as they came up. After three review rounds, I moved on to `/test-task`, and asked for the open follow-ups to be posted where the next tasks will see them.

**Decided / dropped:**

- Mounted only sign-up, sign-in, sign-out and get-session. Every other Better Auth endpoint is a 404 before the library or the database sees the request.
- Turned off sign-in at sign-up (`autoSignIn: false`), so sign-up answers the same for new and existing emails. Better Auth's stand-in answer still differed from a real one, so every successful sign-up now returns the same fixed body.
- Rate limits read the client's IP only from a header the host sets. A client can send any `X-Forwarded-For`, so in production a request without that header is refused.
- Checked production settings on each request, not at import, because CI builds with test values in production mode.
- The proxy checks the session against the database, not just whether a cookie exists, so a stale cookie can't cause a redirect loop.
- Kept the unit tests on the in-memory adapter and ran the PostgreSQL checks live. T07 commits those as integration tests.

**Hardest part, and how I solved it:**
The bugs that mattered were in places where my tests didn't match the real environment. The `next` redirect helper passed every attack case in the tests, but a review found that dot segments (`/.//evil.example`) parse as same-origin and still come out as `//evil.example`, another site. I fixed it by checking the path the helper returns, not just the URL it parsed. Sign-out with no body passed in tests but failed under Next, which gives every POST a body stream, so I made an empty body count as no body and proved it with a test over real HTTP.

**What I learned:**
Security defaults can change with the environment. Better Auth skips its own origin check under `NODE_ENV=test` and trusts a single `X-Forwarded-For` value, so I set those options explicitly and tested them. I also learned to distrust test fakes in exactly the place a check depends on: the in-memory adapter, hand-built requests, and mocked sessions each hid a gap that only a live run against PostgreSQL and real HTTP showed.

## T07 · Test infrastructure: integration DB, auth helpers, contract validation (#7) · Nov 2, 2026

**What I built:** The setup that lets every route be tested against the real database, sessions and API contract.

- A Vitest `integration` project:
  - loads `.env.test` over the shell and `.env`;
  - migrates the test database once and empties every table between files;
  - runs files one at a time.
  - It refuses any database that isn't a local `*_test` one, before migrating, before each reset, and again by asking the connection which database it reached.
- Helpers in `tests/helpers/`: `createUser`, `as(user).call`, `asAnonymous`, `fromOrigin`, `crossSite`, and `expectMatchesOpenApi`, which checks status, headers, media type and body against `openapi.yaml` with Ajv.
- A route coverage test: every operation has a handler, every handler is documented and wrapped in `withApi`, and each one requires a session exactly where the spec does.
- `test:int`, and `test:ci` with the TESTING §4 coverage thresholds (`src/lib/api` held at 100%).
- Integration tests for the T02 and T06 checks that had only been run by hand: column caps, foreign keys, unique indexes, ids, atomic sign-up, cascade delete, the auth flows and the database rate limiter.

**Skills & tools:** Vitest projects and global setup, Prisma 7 `migrate deploy`, PostgreSQL system catalogs, Ajv (JSON Schema 2020-12), Better Auth, Docker PostgreSQL, mutation testing, security and test reviews

**Asked Claude for:** After merging T06, I chose to do T07 before the board sync (T40), approved `ajv` and `ajv-formats`, and kept `src/lib/api` at 100% coverage. After three review rounds I moved on to `/test-task`, then had Claude run the manual checks and handle the open items itself.

**Decided / dropped:**

- Emptied tables with `deleteMany` in one transaction rather than `TRUNCATE`: same result, and no raw SQL built from table names.
- Made the guard accept only URLs every client reads the same way: a loopback host with a port, a plain name ending in `_test`, and no query. `pg` takes the host, port and database from query parameters over the URL's own, and the adapter ignores `?schema=` that the migrate command honours.
- The global setup reads `.env.test` without writing it into `process.env`. Loading it there leaked the test secret into the unit tests' workers and broke T06's production-mode tests.
- The `withApi` mark now records whether a handler requires a session, so route coverage can compare it with each operation's `security`.
- Dropped the CHECK constraint, and then the trigger, that made the account insert fail in the atomic sign-up test. A spy on Better Auth's account write does the same with no database objects, so a killed run can't leave anything behind.
- Skipped a fourth review round: the last Medium was in a test's own logic, and breaking the code proved the fix.
- Let any task remove its own operations from the route coverage test's `NOT_BUILT_YET` list (PLAN §2, CLAUDE.md rule 2). Otherwise every AI-track route (T12, T17, T22) would need an edit to a lead-owned file to pass.

**Hardest part, and how I solved it:**
The hardest bugs were tests that passed without checking what they claimed. Route coverage never compared a route that needs a session, because none exists yet. The concurrent rate-limit test passed whether or not the two requests actually raced. The duplicate sign-up test compared two duplicates, because the table is emptied per file, not per test. I fixed each by forcing the condition: auth checked with handlers built for the test, both inserts held until they collide, a fresh address. Then I broke the code on purpose to watch each test fail.

**What I learned:**
A safety check only works if it reads its input the same way as the thing it protects. My guard parsed the database URL one way while `pg` and Prisma's migrate engine handled query parameters, encoded paths and missing ports differently, so I narrowed the guard to URLs they all read the same and checked the live connection too. I also learned that an error nobody can read is only half a fix: Vitest crashed while printing the guard's refusal, so I made the setup's errors printable and checked them in a live run.

## T40 · Live project board sync: status from issues, PRs and blockers (#58) · Nov 3, 2026

**What I built:** A sync that keeps the project board's Status column in step with issues, PRs and blockers, so nobody has to drag cards by hand.

- `scripts/board-sync.mjs`, plain Node with no packages:
  - reads every issue (state, labels, native blockers, the PRs that close it, linked branches) and every card on the board;
  - places each card: closed → Done; an open team PR → In review; a branch, draft PR or `in-progress` label → In progress; a track label with every blocker closed → Ready; otherwise Backlog;
  - writes only the cards that changed, and `--dry-run` prints the moves without writing;
  - stops before any write if the board's project, Status field or option IDs differ from the pinned ones.
- It runs on my laptop about every 15 minutes, from a copy of `main`'s script, with a token that has only the `project` scope and stays encrypted on my machine. I first built a GitHub Actions workflow for it, then dropped it before merging (below).
- Tests: a fake GraphQL server that accepts only the exact queries checked against GitHub's API, fixtures for forks, drafts, deleted authors and hidden blockers, the command spawned for real, and a config test that keeps `ci.yml` the only workflow.
- CONTRIBUTING: the column rules and how the lead runs the sync.

**Skills & tools:** GitHub Projects v2 GraphQL API, GitHub Actions security (`pull_request_target`, environments, secrets), Windows Task Scheduler and DPAPI, Node's built-in `fetch`, Vitest, mutation testing, threat modelling, security and test reviews

**Asked Claude for:** I asked for the board sync after T07, approved the plan, and after the second review round chose a separate machine account for the board token and a track-label rule for Ready. Before `/test-task` I paused T40 to review two teammates' PRs first, then finished with `/test-task` and `/security-review`. Before merging I asked whether the sync could work without a dedicated bot account, and chose to run it from my laptop instead of GitHub Actions.

**Decided / dropped:**

- A plain Node script with no packages: everything that runs with the board token is one file I can read in full.
- Only open PRs from team members, on this repo and not from a fork, move cards. Anyone can open a PR on a public repo that says "Closes #12".
- Ready needs a track label, so an outsider's issue waits in Backlog until the team triages it.
- Dropped the GitHub Actions workflow and the machine account it needed. Teammates can merge to `main` without an approval, and any change merged there could read a secret stored in CI, so a CI token had to come from a separate account that can reach only this board. I didn't want a second account, so the sync runs on my laptop instead, with a `project`-only token that never leaves it. The cost is that the board only updates while my laptop is on.
- The schedule runs a copy of a commit on `main`, never my working tree, so it never runs a half-edited script or a teammate's branch I'm reviewing. The copy step names the ref in full, because git resolves a short `origin/main` to a tag of that name first.
- Pinned the Status option IDs, not just their names. The board's Auto-close workflow closes any issue moved to Done, so a renamed or swapped option must never let the sync write Done onto open issues.
- Too many linked PRs no longer stops the run. Otherwise an outsider could attach enough fork PRs to one issue to stop the sync for the whole board. The card is placed from the PRs that fit, with a warning, and too many blockers or labels skips only that card.
- A blocker the token can't see never counts as closed, so its card stays in Backlog.

**Hardest part, and how I solved it:**
The hardest bugs were tests that passed while the real sync would have done nothing. The second test review found that my fake GitHub server answered every field whatever the query asked for, so dropping a card's `type` from the query passed every test, while the real sync would have skipped every card. The third found the same shape again: GitHub matches the repository name without regard to case, so a miscased name in the script would still read the issues but never match their PRs. I made the fake accept only the exact query text I had checked against GitHub's API and check the owner, project and field on every request, compared repository names without case, and broke each protection on purpose to watch the tests fail.

**What I learned:**
`pull_request_target` runs the workflow and code from `main`, even for a fork's PR, so it's safe only when the job never checks out or runs the PR's code and no event text reaches a shell. The bigger lesson was that a secret is exposed to everyone who can change the code that runs with it: the environment rule kept the token to `main`, but anyone who can merge to `main` could still read it. Rather than add a bot account to limit what a leak could do, I kept the token off GitHub entirely and run the sync from a pinned copy on my own machine.

## T13 · Courses API (#13) · Nov 3, 2026

**What I built:** The four course endpoints: list and create courses, open a course with its documents, and list a course's concepts with my mastery state.

- `src/lib/services/courses.ts` holds the queries. Every one is scoped to the signed-in user and lists the fields it returns, so another user's course is a 404, the same answer as a course that doesn't exist.
- `src/lib/services/document-status.ts` decides what a document's status reads as. Anything still queued or processing 10 minutes after upload shows as FAILED, so nothing spins forever. T12 will reuse it for `GET /api/documents/{id}`.
- `withApi()` now marks every API response `Cache-Control: private, no-store`, errors included.
- `tests/integration/courses.int.test.ts` covers the security matrix for all four routes and checks every response against `openapi.yaml`.

**Skills & tools:** Next.js 16 route handlers, Prisma 7, zod 4, Vitest integration tests on a Docker PostgreSQL test database, OpenAPI response validation, mutation testing, security and test reviews

**Asked Claude for:** Build T13 from a plan with tests first, and keep the work safe across an internet outage partway through. I chose to put the cache header in `withApi` for every route, and to include the PLAN §8 evidence-quote rule I'd promised in a review of T18.

**Decided / dropped:**

- Set `Cache-Control` once in `withApi` rather than in each route, so routes without a session check, such as Better Auth's get-session, are covered too.
- Shared one status helper between the course view and the document endpoint, so both report a stuck upload the same way.
- Sorted concepts by their normalized name key, so case never decides the order, and broke ties in course and document lists by id, so the order is stable.
- Put the integration tests in `tests/integration/`, because lint bans the database client anywhere under `src/app/`.
- Moved `listCourseConcepts` out of T21's not-built list, since the issue gives it to T13.
- Dropped a `now` parameter on the service and a concept tie-break after a review showed neither was used.

**Hardest part, and how I solved it:**
Proving the concept order was right. A mutation that sorted by the stored name instead of the normalized key passed every test, because the test database's English collation already ignores case, so both orders matched. I added a concept whose key sorts differently from its name, so only the key order passes, and the mutation was then caught.

**What I learned:**
A mutation no test catches can mean the test environment hides the difference, not just that a test is missing. Here the database collation made two sort orders look the same. I also learned to put a header like `Cache-Control` in the one wrapper every response passes through, so a later route can't forget it.

## T21 · Map + next-concept endpoints (#21) · Nov 4, 2026

**What I built:** The two progress endpoints behind the concept map and targeted practice.

- `GET /api/courses/{id}/map` returns every concept in my course as a node with my mastery state and score, and the edges between them. An edge counts only when both ends are in the course, and a concept pointing at itself is dropped.
- `GET /api/courses/{id}/next-concept` picks what to practise next by PLAN §9: PRACTICE before REVIEW before MASTERED, lowest score, then unseen or seen longest ago. It skips the concept of my latest answer in the course unless it's the only one, and returns `null` for a course with no concepts.
- `src/lib/services/map.ts` holds both queries, scoped to the signed-in user, plus a pure `mapEdges` that sorts the edges.
- `tests/integration/progress.int.test.ts` covers the security matrix and the PLAN §9 order on the test database, and `src/lib/services/map.test.ts` unit-tests the edge sorting.

**Skills & tools:** Next.js 16 route handlers, Prisma 7 nested relation filters, Vitest integration and unit tests on a Docker PostgreSQL test database, OpenAPI response validation, mutation testing, security and test reviews, a live HTTP check

**Asked Claude for:** Build T21 from a plan with tests first, then run the manual checks and handle the open items. I chose to keep the `withApi` user-typing fix out of T21 and do it in its own PR afterwards, and to start the flaky-test fix only once T21 is committed.

**Decided / dropped:**

- Kept the `user!` typing cleanup out of this PR (one issue, one PR); it's now T43 (#65), after T21 merges.
- Counted a LOW-confidence answer as my latest answer for the skip: it doesn't change mastery, but it's still the concept I just answered.
- Broke ties between answers saved at the same moment by id, so the pick never flips between requests.
- Skipped the latest-answer lookup when a course has one concept, since the skip can't apply.
- Dropped a real-database test of edge order after it turned out the database couldn't be made to return edges out of order; a unit test of `mapEdges` replaced it.
- Moved the three load-flaky tooling tests to their own issue, T42 (#64), instead of changing their timeouts here.

**Hardest part, and how I solved it:**
Proving the edge sort was the code's own. A mutation that sorted edges by `from` only passed every test, even after I stored one concept's edges in reverse order. Prisma loads them with `fromId IN (...)`, and the unique `(fromId, toId)` index hands them back already sorted by `to`. I moved the sorting into a pure `mapEdges` function and unit-tested it with rows in the wrong order, and the mutation was then caught.

**What I learned:**
A query plan can quietly do a job the code claims to do, so a test that relies on insertion order may never see the difference. When the database can't be made to disagree, testing the logic as a pure function is the honest fix. I also learned that a leak test needs the other user's row to be the only one: when both users had a mastery row, dropping the user filter passed or failed depending on which row came first.

## T42 · Stabilize load-sensitive tooling tests (#64) · Nov 4, 2026

**What I built:** More time-limit headroom for three tests that timed out when the machine was busy, while passing alone.

- `tests/tooling/entry-points.test.ts`: 60 s instead of the 5 s default for the check that parses every source file, like most other tooling tests.
- `tests/tooling/database.test.ts`: the tests that start Node or the Prisma CLI get 90 s (170 s for the one that starts two), and each child process now has its own 80 s limit, so a hung child fails its test instead of stalling the whole run. Two "stops on an unreadable .env" tests now also check the child wasn't killed.
- `src/lib/auth.test.ts`: 60 s instead of 30 s for its cold imports.

**Skills & tools:** Vitest timeout options (file, suite and test level), Node `spawnSync`, stress runs with concurrent test processes, mutation testing, code and security reviews

**Asked Claude for:** Handle the open items left by T21, which became this issue; I chose to start it only after T21 was committed, then said go and asked Claude to run the manual checks.

**Decided / dropped:**

- Set the longer limits only where they're needed (one file, one suite, one test), not as a global default, so a real hang elsewhere still fails fast.
- Gave each Prisma child process its own timeout, because `spawnSync` blocks the test worker and Vitest's timeout can't interrupt it.
- Raised entry-points to 60 s instead of 30 s after the review pointed out that the issue asked for the same limit as the other tooling tests.
- Dropped the after-change stress run: the before-change runs never failed, so a passing run afterwards would prove nothing.
- Left the uncapped Prisma call in a shared test helper for a later tooling PR, since it's outside this issue's three tests.

**Hardest part, and how I solved it:**
I couldn't reproduce the failures: two and then three concurrent test runs all passed. So I measured each test's duration under load to see its margin, and proved with a throwaway test that a suite-level timeout overrides the file's. The review then found that my new child-process timeout could make two guard tests pass by accident: a killed child returns a null status, which passes `not.toBe(0)`. I confirmed it with a child that printed the expected error and then hung, added `expect(res.error).toBeUndefined()`, and a mutation run showed the test now fails.

**What I learned:**
`spawnSync` blocks the worker, so a test-runner timeout can only report an overrun after the fact; the child needs its own timeout. But adding a timeout for safety can change what a test accepts: an assertion that only checks "didn't succeed" also passes for a process the test itself killed. Now I check what a killed process returns before relying on that kind of assertion.

## T45 · Cut deployment from the plan (#72) · Nov 5, 2026

**What I built:** Took the deployment stretch goal (T31, Vercel + Neon) out of the plan. The project now ships as the public repo plus a README that explains how to set it up and run it locally.

- `docs/PLAN.md`: the deliverable, stack, folder list, environments, schedule, cut list, backlog table and risks no longer mention a deployment. It's listed under "Cut to fit the schedule" instead.
- `docs/DEPLOY.md` is deleted. The one test comment that pointed to it now states the rule itself.
- `scripts/backlog.json`: T31 is removed. T33's README criteria now spell out local setup (prerequisites, `npm run setup`, fake or real AI, stopping the databases, common setup problems) and a fresh-clone test on Windows and macOS. T34 no longer mentions a live URL.
- On GitHub: #31 is closed as not planned, and #33 and #34 match `backlog.json`.

**Skills & tools:** Scope planning, GitHub CLI (issues, linked branches), git worktrees, Prettier

**Asked Claude for:** Cut deployment from the plan, because it isn't realistic before the freeze and isn't worth squeezing in, and finish instead with a clean README that explains local setup. I approved Claude's plan, and asked for a full verify run first to see what was failing.

**Decided / dropped:**

- Cut the deployment completely instead of leaving it as a stretch goal, so Friday goes to integration (T28) and reviews.
- Deleted `docs/DEPLOY.md` rather than keep a guide nobody will follow. Git history still has it.
- Kept the settings that are general hardening rather than deployment steps (`DIRECT_URL`, the trusted IP header, API docs off by default), since they still matter to anyone who runs the app.
- The fresh-clone test runs on both Windows and macOS, because the team uses both, and a Windows-only test failure had just blocked pushes.
- Worked in a separate git worktree, because T43 was still uncommitted on its own branch.

**Hardest part, and how I solved it:**
Finding every place that assumed a deployment. It wasn't only the plan: the issue seed file, three issue bodies, a test comment and the deploy guide all pointed to it, and nothing regenerates existing issues from `backlog.json`. I searched the repo for every mention first, then rebuilt each issue's acceptance criteria from the edited `backlog.json` entry, so the plan, the seed file and GitHub agree.

**What I learned:**
Cutting scope is a change like any other: the plan, the task list and the tracker all have to agree, or someone keeps building toward a goal that's gone. Saying what replaces the cut work, a README someone can follow on a fresh clone, makes the end of the project clearer than deleting a line.

## T43 · Non-null session user in withApi handlers (#65) · Nov 6, 2026

**What I built:** `withApi` now types the signed-in user from the `auth` option, so handlers on routes that need a session no longer write `user!.id`.

- `src/lib/api/with-api.ts`: two overloads. The default (or `auth: true`) gives handlers a `SessionUser`. `auth: false`, or an `auth` only known as a boolean, gives `SessionUser | null`. `ApiContext` takes the user type as a second parameter, with `SessionUser` as its default. The runtime code is unchanged: with no session the request still gets a 401 before the handler runs.
- `src/lib/api/with-api.types.test.ts`: a type-level test that fails `npm run typecheck` if `user` has the wrong type. It also checks that a handler needing a user is refused on a route with `auth: false` or a plain boolean.
- The five courses, map and next-concept routes from T13 and T21 drop their `user!`. `auth-route.ts` and `with-api.test.ts` now say outright that their user may be null.

**Skills & tools:** TypeScript function overloads, Vitest `expectTypeOf` type tests, mutation testing on types, live HTTP checks against the test database, code and security reviews

**Asked Claude for:** Build T43 with tests first. Then I held it back until the Windows test fix (T44) merged, and asked Claude to finish it: merge `main`, verify, run `/security-review` and open the PR.

**Decided / dropped:**

- Keyed the overloads on the existing `auth` option, so no route had to change how it calls `withApi`.
- Kept the one cast inside `withApi` itself, type-only and commented, so the routes need none.
- Dropped a third overload after a mutation run showed that removing it broke no test: it was redundant.
- Waited to push until T44 merged rather than fixing T10's Windows tests myself, since those files belong to the AI track.

**Hardest part, and how I solved it:**
Proving the types were really checked. A type test that only checks the happy path passes even when the overloads are too loose, so I added a check that a handler needing a user is refused with `auth: false`. Then I paired it with the same check on `auth: true`, which must pass, so the refusals couldn't be vacuous. To mutation-test types I had to wrap `tsc` in a script that fails only on errors in the type-test file, because the mutation tool treats any type error as a broken build.

**What I learned:**
Overloads are a clean way to make one option change a handler's types, but a test has to check what they refuse as well as what they accept. Running mutations on the overloads themselves showed one of them did nothing, which a review alone wouldn't have caught.
