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

**What I built:** `extractText(data, filename)` in `src/lib/ingest/extract-text.ts`, which turns an uploaded `.pdf`, `.txt` or `.md` file into clean note text or rejects it with a typed `IngestError` (400 / 413 / 422). It checks the size before parsing, requires the content to match the extension, caps PDFs at 100 pages and 15 seconds, and normalizes the text. Claude Code handled the implementation, and I reviewed the plan, made the decisions and tested the results.

**Skills & tools:** TypeScript, unpdf (PDF.js), Unicode normalization, `TextDecoder`, Vitest (fake timers, module mocks, env stubbing, coverage), Claude Code

**Asked Claude for:** A plan with tests for T10, then the implementation once I picked rejecting PDFs over 100 pages instead of truncating them. I also asked that the error clearly explain the 100-page limit without exposing any file contents or parser details.

**Decided / dropped:**

- PDFs over 100 pages are rejected with 413 instead of keeping only the first 100 pages, because silent truncation would let a student think their whole document was processed.
- Error messages are fixed per reason, not per code, so a 413 can say which limit was hit (file size, characters or pages). Parser errors are always replaced with a generic message, so file text never leaks through them.
- `normalizeNoteText` is exported so notes pasted as text (T12) go through the same normalization and limits as uploaded files.
- Dropped a nested `.gitattributes` for the hostile fixtures, because a repo tooling test only allows the root one. The same tests only allow images and PDFs to be binary (secret scanning skips binary files), so the renamed-binary sample is committed as a `.png` and the test uploads it as `.txt`.

**Hardest part, and how I solved it:**
The 15-second PDF time cap. `Promise.race` returns as soon as the timer fires, but it doesn't stop the parse, so a document that finishes loading after the timeout would never be closed. The fix was a `timedOut` flag the parser checks, which closes the late document itself, plus fake-timer tests for each case. Testing also caught two wrong assumptions about the PDF library: in this version `destroy()` lives on `doc.loadingTask`, not on the document, and PDF.js drops text that runs off the page, so our in-test PDF builder had to write one line per `\n`.

**What I learned:**
A timeout built with `Promise.race` only stops the waiting, not the work, so whatever is still running needs its own cleanup path. With file uploads, the extension alone means nothing: the content has to be checked too (magic bytes, valid encoding), and size limits go before any parsing. When I tested the extractor with my own Operating Systems lecture notes, the PDF was rejected because its pages were images rather than selectable text. That showed me the difference between text extraction and OCR, and OCR is a possible future improvement.
