# Work journal: Travis Vinay (@TravisVinay)

**Role:** Frontend on TeachBack, a Next.js app that grades students' explanations against their own notes.

One entry per task, oldest first.

## T05 · App shell, layout, auth page UIs & error boundaries (#5) · Nov 1, 2026

<!-- needs-review -->

**What I built:** The skeleton every screen lives in:

- the root layout with a top nav and a skip link
- placeholder pages for courses, a course, practice and the map
- login and signup forms with client-side validation (not wired yet; T06 wires them)
- error, loading and not-found screens
- a small accessible UI kit in `src/components/ui` (Button, Input, Textarea, Card, Badge, Spinner, EmptyState, ErrorState)

**Skills & tools:** Next.js 16 App Router (route groups, `error.tsx` / `global-error.tsx` / `not-found.tsx` / `loading.tsx`, async `params`), React client components and hooks, Tailwind CSS v4 theme tokens, accessibility (labels, `aria-describedby`, `aria-invalid`, focus management), Vitest + Testing Library (jsdom)

**Asked Claude for:** Keep working on my other ready tasks while the lead was busy reviewing T09, starting with T05 from the issue's acceptance criteria.

**Decided / dropped:**

- Error boundaries show only a fixed message and Next's error digest as a reference, never `error.message`, because in development Next forwards the real message and it can contain anything.
- Followed Next 16.4's installed docs: error boundaries get `retry()` (not the older `reset()`), and `error` is typed `unknown`, so it's narrowed before reading `digest`.
- Added a Name field to signup now, because Better Auth's email sign-up needs it, so T06 only has to wire the form.
- Left `next` redirect validation on the login page for T06, since the forms aren't connected yet.
- Shared the form logic in one `useAuthForm` hook instead of duplicating it in both forms.
- Added a root `not-found.tsx` and a `global-error.tsx` on top of the app-route boundaries: unknown URLs never reach a route group's not-found page, and `error.tsx` can't catch errors in the root layout itself.

**Hardest part, and how I solved it:**
Testing that a form can't be submitted twice. My first test clicked the button again while it was busy and failed to find it, because the spinner adds "Working…" to the button's accessible name. Clicking a disabled button also wouldn't prove much, because pressing Enter in a field still submits the form. So the test now clicks the busy button _and_ fires a submit on the form directly, and checks `onSubmit` ran only once. That exercises the pending guard in the hook, not just the disabled attribute.

**What I learned:**
A disabled button isn't enough protection against double submits; the submit handler needs its own guard. I also learned that `node_modules` doesn't follow branch switches. The repo's lockfile test failed on this branch because packages from my T09 branch were still installed, and `npm prune` fixed it without touching any tracked file.

## T16 · Practice session UI (feedback mocked) (#16) · Nov 1, 2026

<!-- needs-review -->

**What I built:** The core practice screen at `/courses/[courseId]/practice`. With no `?concept=` it shows a concept picker with mastery badges. With one, it runs the loop: a question card with its source labels, an answer box (4000-character limit with a counter, Ctrl/Cmd+Enter to submit, no double submits), short feedback, and "Next question". The components live in `src/components/practice/`, and they run against the T09 mock endpoints until the real routes land.

**Skills & tools:** Next.js 16 App Router (async `params` and `searchParams`), React 19 client components and effects, `AbortController` for request cleanup, the typed openapi-fetch client and its mocks, Vitest + Testing Library (jsdom)

**Asked Claude for:** Start T16 once T05 and T09 were merged (I checked CI on my open PRs and merged them first), build it from the acceptance criteria, then test it and run a security review.

**Decided / dropped:**

- The answer limit comes from the shared `LIMITS.answer` instead of a hard-coded 4000, so the UI can't drift from the server.
- Components take an optional `client` prop that defaults to the app's client. Tests pass a client backed by the real mock handlers, or a fake network that fails in a chosen way.
- Dropped the "Try again" button after a failed submit: it would have bypassed the form's double-submit guard. The answer is kept and Submit sends it again.
- A malformed `?concept=` shows "Concept not found" without calling the server. The page keys the session on the concept id so a new concept starts fresh.
- Kept the feedback display minimal (verdict, right, missing, mastery chip) because T23 builds the full version.

**Hardest part, and how I solved it:**
The first version loaded the question with a function called from `useEffect` that set a loading state right away, and the React hooks lint rule rejected it ("calling setState synchronously within an effect"). I restructured both the session and the concept picker so the effect only sets state when the request finishes, and "Next question" and "Try again" became event handlers that reset the state and bump a counter the effect depends on. That also made cancelling simple: each run of the effect owns its own `AbortController` and aborts it in cleanup.

**What I learned:**
A disabled button doesn't stop two submits fired in the same tick (a click plus Ctrl+Enter), because the `pending` state only shows up on the next render. A ref checked at the top of the submit handler closes that gap. I also learned that an effect should only start the async work and react to its result. Resetting state belongs in the event handler that triggers the reload.

## T15 · Notes library & upload UI (#15) · Nov 4, 2026

<!-- needs-review -->

**What I built:** The notes side of the app, plus real sign-in:

- login, signup and sign-out wired to Better Auth, with fixed error messages and a same-origin check on `?next=`
- `/courses`: list and create courses
- `/courses/[courseId]`: upload a file or pasted text, a status list that polls each document until it's ready or failed, and the course's concepts with links to practice
- a `charCount` helper so field counters count characters the way the server does

**Skills & tools:** Next.js 16 App Router, React 19 client components and effects, Better Auth's client, `AbortController` and polling with backoff, the typed openapi-fetch client and its mocks, Vitest + Testing Library (jsdom)

**Asked Claude for:** Build T15 from the acceptance criteria, then apply the lead's review on PR #59: aborts on the mocks, stale answers after unmount or a course change, the upload form keeping a file after switching modes, counters and limits that match the server, and a few more `?next=` and double-submit cases. Each fix got a test that failed before it.

**Decided / dropped:**

- The mock fetch now honours the request's abort signal. openapi-fetch leaves that to `fetch`, so before the fix an aborted request on the mocks still created data.
- `isAbortError` checks the error's name only, because in jsdom an abort error isn't an instance of the global `DOMException`.
- Counters count trimmed code points, like the server's `text()`. Fields keep the native `maxLength` as an upper bound: it counts UTF-16 units, which are never fewer than code points, so it can stop typing a little early but never lets a too-long value through.
- Each auth field is counted the way the server counts it: names by code point, passwords and email in UTF-16 units. All limits come from the shared `LIMITS`.
- The auth form stays busy after a successful sign-in, so a second click can't sign in again while the page navigates.

**Hardest part, and how I solved it:**
Proving the "ignore a late answer" guard in the course page. My first test passed even without the fix, because the mock now rejected the aborted request, so the late answer never arrived. The test now holds the first request and answers it with a copy of the request that has no abort signal, which is what a slow real server can do. With that, the test failed until I added the `signal.aborted` check.

**What I learned:**
Aborting a request doesn't stop code that is already waiting on it: after every `await` in an effect, check whether it was cancelled before setting state. And a regression test only counts once you've seen it fail without the fix.

## T26 · Practice weakest flow (#26) · Nov 5, 2026

<!-- needs-review -->

**What I built:** A "Practice weakest" button on the course page and the concept map that opens `/courses/[id]/practice/weakest`. There, `weakest-practice.tsx` asks the API for the concept I'm weakest at, shows its name and mastery state, and runs the usual question → answer → feedback loop; "Next concept" picks the next weakest one. It handles a course with nothing to practise, a rate limit (with Try again), a missing course, and leaving the page mid-request.

**Skills & tools:** Next.js App Router (async `params`, generated route types), React state and effects, `AbortController`, openapi-fetch, Vitest, Testing Library

**Asked Claude for:** To plan and build T26 right after T23, while T23 waited on a fix to another track's tests.

**Decided / dropped:**

- Reused the existing `PracticeSession` and gave it an optional `onNext`, instead of writing a second practice loop. Without `onNext` the normal practice page behaves exactly as before.
- Keyed each session by concept and round, so getting the same concept twice still starts a fresh question and an empty answer box.
- Made the button a link, so it works before any JavaScript loads and matches the other course links.
- Made the mock next-concept endpoint move through the concepts, so the loop visibly moves on in dev instead of repeating one concept.
- Added the button to the map page knowing T25 was rewriting that page, and accepted a small merge conflict over waiting for T25.

**Hardest part, and how I solved it:**
Adding a new page broke the typecheck: `PageProps<"/courses/[courseId]/practice/weakest">` was rejected because Next's generated route types didn't know the route yet. Running `next typegen` regenerated them. The page tests then also had to pass `searchParams`, since `PageProps` requires it even when the page doesn't use it.

**What I learned:**
Changing a component's `key` is the simplest way to reset all of its state, which is what moving to the next concept needs. I also learned to guard "next" actions against double clicks by ignoring a click while a request is already loading, and to cancel requests on unmount with an `AbortController` so a late response can't update a page that's gone.
