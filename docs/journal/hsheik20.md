# Work journal: Husein Sheikh (@hsheik20)

**Role:** AI on TeachBack, a Next.js app that grades students' explanations against their own notes.

One entry per task, oldest first.

## T04 · Claude API wrapper + fake provider with failure modes (#4) · Oct 31, 2026

**What I built:** The single way the app calls Claude: `generateJson()` in `src/lib/ai/provider.ts`. It uses the Anthropic SDK's structured outputs, re-validates with zod, retries once and turns every failure into a typed `AiError` (TIMEOUT, RATE_LIMITED, UPSTREAM, INVALID_OUTPUT). It comes with a free, deterministic fake provider (`src/lib/ai/fake.ts`) that has five selectable failure modes for later tasks and CI, and an `npm run ai:ping` script that checks a real key. Claude Code was the main implementer. I owned the plan, reviewed the implementation, coordinated decisions with the lead and did the testing.

**Skills & tools:** TypeScript, `@anthropic-ai/sdk` (structured outputs, Zod helper, prompt caching), zod v4, Vitest (mocks, env and fetch stubbing), npm lockfiles, Claude Code

**Asked Claude for:** A plan with tests for T04, and then the implementation once I'd taken its open questions to the lead and come back with decisions: a required `task` option, a lockfile cleaned up with npm 11, and an `AI_FAKE_FAILURE` env var. I also had it stash an unrelated lockfile change so it stayed out of this PR.

**Decided / dropped:**

- The real and fake providers share the same validate → retry → error-mapping code, and the fake throws the SDK's real error classes, so testing the fake tests the real logic. `task` became a required option, approved by the lead, so the fake knows which fixture to return. We dropped a separate `"ping"` value for it.
- Only bad output and server or connection errors are retried, and the SDK's own retries are off. Retrying a timeout doubles the wait, and retrying a rate limit or a bad key won't help.
- `AiError` has a fixed message per code and never carries the original error, so the API key can't leak through it. An unset `AI_PROVIDER` throws instead of silently using the fake.
- Dropped the lockfile from my old npm 10, which stripped about 145 unrelated `libc` lines, and regenerated it with npm 11 on Node 24 to match the team standard.

**Hardest part, and how I solved it:**
Coordinating the shared pieces. Adding `task` to the `generateJson` signature and a new env var affects later tasks, so I took those to the lead before any code was written. The lockfile was its own problem: my npm 10 kept rewriting unrelated lines, and `main` moved to Node 24 / npm 11 mid-task, so we regenerated the lockfile with npm 11 and merged `main` cleanly. On security, Claude implemented tests showing the API key never shows up in errors or logs, and checked them by breaking the code on purpose to confirm they fail. The fake key in those tests even tripped our pre-commit secret scan, so we renamed it.

**What I learned:**
Structured outputs get you the right JSON shape but don't enforce limits like `max`, so you still need a zod check, and a validation failure is one of the few errors worth retrying. Retries should depend on the error type: a timeout or a rate limit just gets worse if you retry it. And when a lockfile diff fills up with changes nobody asked for, check everyone's npm version before anything else.

## T10 · Text extraction + upload validation (#10) · Nov 1, 2026

**What I built:** `extractText(data, filename)` in `src/lib/ingest/extract-text.ts`, which turns an uploaded `.pdf`, `.txt` or `.md` file into clean note text or rejects it with a typed `IngestError` (400 / 413 / 422 / 429). It checks the size before parsing, requires the content to match the extension, parses PDFs in a separate child process that is killed at 15 seconds or when a watchdog sees it pass a 512 MB memory threshold (with a 100-page cap and at most two parses at once), and normalizes the text. Claude Code handled the implementation, and I reviewed the plan, made the decisions and tested the results.

**Skills & tools:** TypeScript, unpdf (PDF.js), Node `child_process` and `worker_threads`, Unicode normalization, `TextDecoder`, zlib, zod, Vitest (module mocks, fake timers, spies, coverage), Claude Code

**Asked Claude for:** A plan with tests for T10, then the implementation once I picked rejecting PDFs over 100 pages instead of truncating them. I also asked that the error clearly explain the 100-page limit without exposing any file contents or parser details. After the lead's review, I asked for the fixes with proof that the worker really terminates, a heartbeat test that isn't sensitive to CI timing, and replacement of malformed surrogates. When a security review of that fix found new problems, I paused T10 until the lead approved moving parsing into a child process, then asked for that with a 20 ms memory watchdog, as he suggested. Last, I asked for a security review against his six requirements and a check of whether the parent could see the child exit before reading its answer.

**Decided / dropped:**

- PDFs over 100 pages are rejected with 413 instead of keeping only the first 100 pages, because silent truncation would let a student think their whole document was processed.
- Error messages are fixed per reason, not per code, so a 413 can say which limit was hit (file size, characters or pages). Parser errors are always replaced with a generic message, so file text never leaks through them.
- `normalizeNoteText` is exported so notes pasted as text (T12) go through the same normalization and limits as uploaded files.
- Dropped a nested `.gitattributes` for the hostile fixtures, because a repo tooling test only allows the root one. The same tests only allow images and PDFs to be binary (secret scanning skips binary files), so the renamed-binary sample is committed as a `.png` and the test uploads it as `.txt`.
- Dropped my first in-process time cap (`Promise.race` against a timer) after the lead's review showed a small compressed PDF could keep PDF.js busy without yielding, so the timer never fired.
- Then dropped the worker-thread fix too: a security review found that a 1 KB PDF could make V8 abort the whole server from inside the worker, and that PDF.js could allocate gigabytes outside the worker's heap limit. With the lead's approval, PDFs are now parsed in a child process with a 256 MB heap, a watchdog that checks its memory every 20 ms and kills it past a 512 MB threshold, a 15-second kill, none of the app's secrets, and at most two parses at once (then 429).
- Changed `next.config.ts` and its pinned test in `tests/tooling/project-config.test.ts`, both under exceptions the lead approved, so the child's files ship with the build.
- The final security review found that when the server can't start the child (out of memory or file descriptors), the upload waited forever and kept one of the two parse slots, so two failures blocked every PDF upload until a restart. That case now returns 429 `PDF_BUSY` instead of 422, because the server is temporarily short, not the PDF unreadable, and regression tests check that the slot is freed.
- The parent now waits for the child's `close` event instead of `exit`, because Node doesn't guarantee it has read the child's answer when it reports the exit. I couldn't reproduce the race locally, so a regression test delivers the answer after the exit.
- After Jonathan's final review, I added an independent deadline to the child's memory watchdog so PDF parsing can't continue indefinitely if the server crashes. I tested this by killing a stand-in server during parsing and confirming the child terminated on its own.
- Also from review: the note limit counts characters (code points) after trimming, the same way the request schemas count them, and unpaired surrogates are replaced with U+FFFD so PostgreSQL never refuses the text. I kept `unpdf@2.1.0` because the lead had already checked the package.

**Hardest part, and how I solved it:**
Containing a hostile PDF. My first time cap used `Promise.race`, which can't stop CPU-bound work on the same thread, so I moved parsing into a worker thread and proved it with a heartbeat test. A security review then showed a worker isn't enough: a 1 KB PDF made V8 abort the entire process, and a compressed stream could allocate gigabytes outside the worker's heap limit. The fix was a child process with a memory watchdog thread, and the tests build each attack in memory and check that the server survives, including that the child really died from V8's abort.

**What I learned:**
A timer only fires when the event loop is free, and a worker thread still shares its process, so a crash or memory blow-up inside it can take the server down; real isolation needs a separate process. With file uploads, the extension alone means nothing: the content has to be checked too (magic bytes, valid encoding), and size limits go before any parsing. When I tested the extractor with my own Operating Systems lecture notes, the PDF was rejected because its pages were images rather than selectable text. That showed me the difference between text extraction and OCR, and OCR is a possible future improvement.

## T18 · Evidence verification (pure function) (#18) · Nov 3, 2026

**What I built:** `verifyEvidence(feedback, chunks)` in `src/lib/ai/verify-evidence.ts`, the check that every quote shown as grading evidence really appears in the cited section of the student's notes. It normalizes both sides (NFKC, lowercase, straight quotes and dashes, collapsed whitespace), drops quotes with an unknown chunk or no match, caps confidence at MEDIUM when anything is dropped, and sets LOW plus `unsupported` when nothing is left. Claude Code handled the implementation, and I reviewed the plan, made the decisions and tested the results.

**Skills & tools:** TypeScript (generics, utility types), Unicode normalization (NFKC), zod v4, Vitest (seeded randomized tests, coverage), mutation testing by hand, Claude Code

**Asked Claude for:** A plan with tests for T18, then the implementation with NFKC folding added, as long as the tests proved that quotes with genuinely different wording are still rejected. I also asked to see the results before moving on.

**Decided / dropped:**

- Added NFKC to the normalization in PLAN §8. It helps account for formatting differences in PDF text, like the `ﬁ` ligature and `…`, which the model writes as `fi` and `...`, and the tests check that genuinely different wording is still rejected.
- A quote that spans two chunks is dropped, since it isn't a substring of the chunk it cites.
- No evidence at all counts as `unsupported`, and `unsupported` is always set by the function, never taken from the model.
- A quote must be at least three words. I first left this to T22 because the spec only says non-empty, but in review Jonathan pointed out that a word like "the" is in almost every chunk, so a manipulated answer could cite it and keep HIGH confidence. This function is the grounding check, so the minimum belongs here.
- Left words hyphenated across line breaks as a T10/T11 text-cleanup follow-up instead of fuzzing the matching here.

**Hardest part, and how I solved it:**
Making the randomized test prove something. A "fabricated" quote built from words in the notes can accidentally be real, so each one gets an invented word, a swapped word, or a phrase from another chunk, and it's checked with a separate simple normalizer and regenerated if it's actually in the note. A mirror test makes sure 200 real quotes with random spacing and case always survive, and both use fixed seeds so a failure can be reproduced. To confirm the tests have teeth, we broke the function on purpose (ignoring the chunk id, allowing empty quotes, removing NFKC, the confidence cap or the three-word minimum), and every change made at least one test fail.

**What I learned:**
Checking that a quote "appears in the notes" sounds simple, but the result depends on how you clean up the text first. Normalization smooths over formatting differences, and it can also hide details: the security review pointed out that NFKC turns `10⁵` into `105`. A quote being in the notes doesn't automatically make it good evidence either, which is why a one- or two-word quote is now rejected. And I learned that TypeScript's `Omit` on a type with an index signature erases its known keys, so the result type has to name the important fields explicitly.

## T11 · Chunker (#11) · Nov 4, 2026

**What I built:** `chunk(text, title)` in `src/lib/ingest/chunk.ts`, which splits note text into the numbered passages that concepts, questions and evidence cite. It finds Markdown headings (ignoring `#` lines inside code blocks), or, for plain text and PDFs, short heading-like lines after a blank line or a finished sentence. It packs text into chunks of up to 400 words or 4,000 characters, merging small sections forward until a chunk reaches about 150 words, and labels each one like `Week 4 › TCP ¶2`. Every chunk is an exact slice of the notes, so nothing is rewritten or dropped except the whitespace between chunks, and a document over 300 chunks throws a typed `IngestError` (`TOO_MANY_CHUNKS`). Claude Code handled the implementation, and I reviewed the plan, made the decisions and tested the results.

**Skills & tools:** TypeScript (function overloads, mapped and conditional types), `Intl.Segmenter` (grapheme clusters), Unicode, Vitest (seeded randomized tests, spies, coverage), mutation testing by hand, Claude Code

**Asked Claude for:** A plan with tests for T11, then the implementation once I'd chosen to merge small sections, on the condition that it didn't cost citation accuracy: a merged chunk's label couldn't credit everything to its first heading, and content had to be rejected, never silently dropped. After the first version I raised two concerns: headings left alone at the very end of the notes, and `chunk.ts` importing from the extraction module just to throw an error. Then I ran `/test-task`, had Claude walk me through the manual checks one step at a time, and ran `/security-review` with six focus areas. Last, I approved a small fix for the label performance problem the review found and had Claude draft a GitHub issue for an upstream problem it uncovered.

**Decided / dropped:**

- When small sections merge, the label names the range, like `Week 4 › Intro ¶1 – Summary`, so a citation never points only at the first heading. The `¶n` counts chunks within a heading, so two chunks from the same section stay distinguishable.
- Above 300 chunks, T11 throws a typed `IngestError` (`TOO_MANY_CHUNKS`) with a fixed message asking the student to split the file, so the upload flow can reject it. I chose this over keeping the first 300, for the same reason as T10's page limit: silent truncation would hide missing notes.
- Long paragraphs split at sentences, then words, then grapheme clusters, so an emoji or an accented letter is never cut in half. One unbreakable cluster (thousands of combining marks) can still exceed 4,000 characters. I accepted that as a documented exception rather than break a character.
- A heading at the very end of the notes now joins the chunk before it, when that still fits, instead of becoming a chunk with nothing to cite.
- I moved `TOO_MANY_CHUNKS` into the ingest error list so `chunk.ts` only depends on `errors.ts`. A typed constructor overload lets reasons with fixed messages be thrown without the limits, and the compiler rejects the others.
- Words hyphenated across line breaks in PDFs are kept as extracted. Fixing them is a text-cleanup follow-up, not part of chunking.

**Hardest part, and how I solved it:**
Proving that nothing was lost, duplicated or reordered. A single check rebuilds the original notes from the chunks plus whitespace, and it runs on every test, on the real fixtures and on 300 randomized documents with fixed seeds. Getting the timing tests to catch slow code was harder than it looked: the hostile-input test first passed even when a slow regex was put back in, so we rebuilt it with a 150,000-space line, where the slow version takes about 14 s against a 3-second limit. The heavy tests also have 60-second timeouts; those don't weaken the limit, they only stop a busy machine from failing them. The security review then found that a heading close to the note limit was cleaned up again for every chunk, about 650 ms of blocking CPU. Doing it once per section brought that down to about 40 ms, with byte-identical output across 34,000 chunks, and the regression test counts how often the heading is cut instead of timing it, so it can't flicker under load.

**What I learned:**
Citation accuracy is a design decision: merging small sections makes better chunks, but the label has to say what was merged, or the feedback points students to the wrong part of their notes. JavaScript strings don't always treat what we see as one character as a single unit. Some emoji and accented characters consist of multiple parts, so I learned why splitting at grapheme boundaries matters. And a security review can find problems upstream: reviewing my chunker found that my T10 code runs NFC normalization before the length check, and a note-sized input blocked the server for about 12 s. I documented the issue in #69 instead of expanding T11's scope, so Jonathan can decide whether it needs to be fixed before T12 introduces uploads.

## T44 · Make PDF child-process tests pass on Windows (#68) · Nov 5, 2026

**What I built:** Cross-platform versions of the five T10 tests that failed on Windows, which blocked every push from a Windows machine because the pre-push hook runs them. In `src/lib/ingest/extract-text.child.test.ts` and `extract-text.limiter.test.ts`, a small `expectEndedBy` helper checks how a child process ended: the exact signal on Linux and macOS, as before, and no signal with a non-zero exit code on Windows, which doesn't report POSIX termination signals the way Linux and macOS do. The fork-path check now compares the full platform path. No production code changed. Claude Code handled the implementation, and I reviewed the plan, made the decisions and tested the results.

**Skills & tools:** Node `child_process` (exit codes vs. signals), cross-platform paths (`node:path`), Vitest (annotations, platform-specific assertions), mutation testing by hand, GitHub CLI, Claude Code

**Asked Claude for:** A plan for T44 that showed the exact Windows failures before any code was written, then a read-only search for whether Jonathan had already posted his Windows output (he hadn't). I chose to go ahead without it, following the issue's "non-zero exit code" rule rather than assuming exact codes, and asked for the server-death test to be handled without guessing how Windows behaves.

**Decided / dropped:**

- Windows tests check for a non-null, non-zero exit code instead of exact codes (134 for an abort, 1 for a kill). Those numbers come from how Node and libuv usually behave, but nobody had seen them on our machines. The trade-off is that Windows can't tell an abort from a kill; Linux and macOS still can.
- Linux and macOS stay at least as strict: they now require `{ code: null, signal }` exactly, and the fork-path check is an exact match instead of a suffix.
- Windows may end a child along with its parent, but I couldn't confirm that. So on Windows the server-death test records whether the child survived as a test annotation, and still requires it to be gone within 8 seconds. Linux and macOS still assert that the child outlives the server.
- Production code is unchanged. It already treats any exit without an answer as a failure and never uses the signal to choose the error, and existing tests already cover Windows-style exits.
- Dropped a suggestion from the security review to also reject exit code 1 on Windows, because it relied on an exit code we hadn't observed.

**Hardest part, and how I solved it:**
Fixing tests for a platform I couldn't run. The issue didn't include Jonathan's actual failure output, so we first checked the issue, the T10 PR and CI for it, and found that CI only runs on Linux. From then on we separated what was confirmed from what was assumed. To make sure the Linux and macOS checks still had teeth, we broke the watchdog on purpose: it sent SIGTERM, ignored the deadline, or treated an invalid deadline as no deadline, and each break made a test fail. A temporary copy of the tests that pretended to be Windows showed that the Windows checks accept and reject the right exit shapes. All the tests passed on my Mac, but the final confirmation still needs to come from running them on Windows.

**What I learned:**
Windows doesn't report POSIX termination signals the way Linux and macOS do: a process killed or aborted there shows up as an exit code with no signal, so tests that assert a signal only work on Linux and macOS. Paths differ too: `path.join` gives backslashes on Windows, so comparing against the same `path.join` call is more reliable than matching a hard-coded suffix. And when I can't test on a platform, it's better to have the test record what happens there than to assert behavior I've only read about.

## T08 · Seed script (#8) · Nov 6, 2026

**What I built:** `npm run db:seed` in `prisma/seed.ts`, which loads demo data for development and the cross-user checks. It creates two demo accounts through Better Auth's server API, so passwords are hashed exactly as in sign-up. Demo user A gets a course with a READY document of fictional sorting-algorithm notes, split by the real T11 chunker into 10 chunks, plus 5 concepts linked to those chunks, 4 prerequisite edges and 2 questions. Demo user B gets a small course of their own. The seed is safe to re-run, refuses to run when `NODE_ENV=production`, and the accounts are listed in a new "Demo accounts" section of the README. Claude Code handled the implementation, and I reviewed the plan, made the decisions and tested the results. I ran the seed myself, including a re-run, and confirmed that it refuses to run in production. I signed in to both demo accounts and checked that demo user B gets a 404 for demo user A's course, in both the UI and the API.

**Skills & tools:** Prisma 7 (interactive transactions, `createManyAndReturn`), PostgreSQL advisory locks, Better Auth server API and password verification, tsx, Vitest integration tests, GitHub CLI, Claude Code

**Asked Claude for:** A plan for T08, which I extended before any code was written: re-runs had to keep demo progress, a failed or half-finished seed had to be safe to retry, and an existing account with a demo email could never have its password reset or be reported as working unless its sign-in was verified. I waited for Jonathan to approve the test file in his folder before building. After testing, I had Claude confirm the seed would hit my local dev database, and investigate a failed sign-in as a possible bug using read-only checks. Finally, I had it merge T12 and switch to T12's shared concept-name helper.

**Decided / dropped:**

- A user who already has the demo course is skipped, not reset, so attempts and mastery survive a re-run. The seed never deletes anything.
- An existing account is used only if the demo password verifies against its stored hash, using Better Auth's own verifier, which creates no session. Any other account is left untouched and reported as a conflict, and the run exits with an error.
- Each user's course is written in one transaction, behind a per-user Postgres advisory lock, so a failure rolls back completely and two runs at once can't duplicate a course.
- I wrote new fictional notes instead of reusing an existing test fixture, because that fixture names a real course code and the repo is public.
- `/test-task` found that every failure told you to delete the account. A database error got that advice too, so account conflicts now have their own status, and only they suggest deleting.
- The tests live in `tests/integration/seed.int.test.ts`, a one-file exception Jonathan approved, rather than a change to the Vitest config.
- After merging T12, the seed uses T12's `conceptNameKey`, so notes uploaded to a demo course later merge with the seeded concepts. I dropped the seed's own key function.

**Hardest part, and how I solved it:**
Making the seed safe to re-run and retry without touching anything it doesn't own. With auto sign-in off, Better Auth answers a taken email with a stand-in user instead of an error, so the seed reads the account back and checks the stored hash before writing any data. Each user's data goes in one transaction, so the tests could break things on purpose: a run that died after sign-up, a duplicate concept that fails mid-transaction and rolls back, and an account with someone else's password, whose stored hash is unchanged afterwards. In each case a later run either completes the data or leaves the account alone.

**What I learned:**
To make a script idempotent, the "does it exist?" check has to happen inside the transaction, under a lock, not before it. Otherwise two runs can both decide to create the same data. Verifying a password with the auth library's own verifier is a safe way to confirm credentials without signing in or changing anything. And when a library logs an error, reading where in its source that log is written can rule out whole causes: Better Auth only logs "Invalid password" after it has already found the user, which ruled out a database mismatch right away.

## T22 · Answer evaluation endpoint (#22) · Nov 6, 2026

**What I built:** `POST /api/questions/{id}/answer`, which grades a student's answer to one of their own questions against that concept's notes using the smart model, keeps only evidence quotes that really appear in the notes, and saves the Attempt. The route (`src/app/api/questions/[id]/answer/route.ts`) calls `answerQuestion` in `src/lib/services/answer.ts`, which uses the new `evaluateAnswer` prompt and schema in `src/lib/ai/evaluate-answer.ts`.

**Skills & tools:** Next.js route handlers, Prisma transactions, zod v4, Claude API structured output, prompt-injection defenses, Vitest unit and integration tests

**Asked Claude for:** I had Claude plan and implement the T22 answer-evaluation endpoint, including the security and integration tests. Before implementation, I asked it to address an edge case involving escaped characters in evidence quotes and structure the database transaction so T24 could build on it later. After implementation, I reviewed the testing results and manually tested answer evaluation, prompt injection, validation, cross-user access, fabricated evidence and AI failures. When VS Code unexpectedly restarted during testing, I had Claude confirm that all my work was preserved before continuing with the security review.

**Decided / dropped:**

- The model only sees short source keys (`s1`, `s2`, ...) that the server maps back to chunk IDs. It never sees or picks a database ID, so a quote can't be pointed at someone else's chunk.
- Quotes are checked only against the chunks actually sent after the prompt budget trimmed them, so a quote from a chunk that was cut off fails verification.
- The AI call runs under one 90-second deadline and outside the database transaction. An AI failure returns 502 `AI_UNAVAILABLE` and saves no Attempt.
- Reused T17's chunk select, note ordering, budget and control-character helpers (`NOTE_CHUNK_SELECT`, `inNoteOrder`, `withinBudget`, `withoutControls`) instead of copying them.
- Mastery is read but not updated here. The row-locked update is left to T24.

**Manual testing (checked by me in the running app):**

- Normal answer: 200, PARTIAL verdict, two evidence citations with chunk IDs and reference labels, mastery unchanged.
- Prompt-injection answer: 200, verdict stayed PARTIAL (fake provider).
- A 4,001-character answer: 400 `VALIDATION_ERROR` naming the `answer` field.
- Demo User B answering Demo User A's question: 404.
- Fabricated evidence: 200, fabricated quotes removed, `unsupported` true, confidence LOW.
- AI timeout: 502 `AI_UNAVAILABLE` with the friendly message and no internal details.

The automated integration tests (not my manual checks) assert that an AI failure saves no Attempt.

**Hardest part, and how I solved it:**
The notes go to the model HTML-escaped to protect the prompt, so a true quote could come back as "&amp;" instead of "&" and fail the word-for-word check against the notes. I added a single-pass `unescapeText` and a `quoteAsInNotes` step that only chooses which spelling of the quote to check, so the substring check itself never gets looser. I also manually tested the fabricated-evidence failure mode and confirmed that unsupported quotes were removed and confidence dropped to LOW.

**What I learned:**
Model output has to be treated as untrusted even when it's structured: zod validates its shape, but every citation still has to be checked against text the server controls. I also learned to keep slow AI calls out of database transactions and put them under one overall deadline, so a timeout fails cleanly with a fixed message and leaves no partial data behind.

## T41 · Cover the last two branches in the AI wrapper (fake.ts, provider.ts) (#56) · Nov 7, 2026

**What I built:** Two unit tests that cover the last untested branches in the AI wrapper, bringing every file in `src/lib/ai/` to 100% branch coverage. In `fake.test.ts`, a prompt with only a whitespace chunk checks that the fake provider's `firstWords` falls back to the text itself and still returns schema-valid questions and concepts. In `provider.test.ts`, a transport that throws an `AiError` checks that `toAiError` passes the same object through without retrying. No production code changed.

**Skills & tools:** Vitest (mocks, identity vs. equality assertions), V8 branch coverage, zod, GitHub CLI, Claude Code

**Asked Claude for:** A plan for T41 with no production code changes, then the two tests with exact expected values for the fallback case and an identity check plus a single-call check for the `AiError` case. I also asked for confirmation from `npm run test:ci` that `src/lib/ai/` reached 100% branches, while keeping my other branches and stashes untouched.

**Decided / dropped:**

- The fallback test uses `generateQuestion` and `extractConcepts` to exercise the actual fake-provider behavior. I checked the exact returned values and schema validation rather than relying on coverage numbers alone.
- The pass-through test uses `toBe(thrown)` instead of `toMatchObject({ code })`. The existing error-mapping tests only compare fields, which can't tell a passed-through error from a new one with the same code.
- Left the branch gaps in `services/` and `mastery/` alone. They came from tasks merged after this issue was written, and most of `services/` is in the lead's track, so they're listed as follow-ups in the PR.

**Hardest part, and how I solved it:**
Making the fallback branch reachable through the public API. `firstWords` only returns the raw text when its regex finds no word, and `readChunks` trims each chunk, so a chunk of spaces and tabs becomes an empty string that takes exactly that path. Separately, `npm run verify` first failed type-checking and the build because of generated route types left over from my T22 branch, which pointed at an endpoint not on `main` yet. Deleting the git-ignored `.next/dev/types` folder fixed it without touching any tracked file.

**What I learned:**
Line coverage can be 100% while a branch is still untested: a ternary runs on every call, but only one side may ever be taken. An equality assertion also can't prove an object was passed through unchanged; you need an identity check like `toBe`. And our coverage report hides fully covered files, so a folder missing from the table means it's at 100%. I confirmed the per-file numbers in `coverage-summary.json` rather than assuming.
