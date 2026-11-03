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

## T15 · Notes library & upload UI (#15) · Nov 2, 2026

<!-- needs-review -->

**What I built:** The screens that get notes into the app. Login, signup and sign-out now go through Better Auth's client, with friendly errors (including the rate-limit message) and a safe return to the page in `?next=`. `/courses` lists and creates courses, and `/courses/[courseId]` uploads notes as a file or pasted text, shows each document's status while it processes, and lists the concepts once notes are ready. The main files are in `src/components/notes` and `src/components/auth`, plus a session-aware nav (`nav-auth.tsx`).

**Skills & tools:** React 19 client components and effects, polling with `setTimeout`, backoff and `AbortController`, Better Auth's React client (`useSession`, sign-in/up/out), openapi-fetch with multipart `FormData`, Next.js 16 App Router (async `searchParams`, `useRouter`), Vitest + Testing Library with fake timers

**Asked Claude for:** Build T15 from the issue's acceptance criteria with a plan and tests first, then verify it, run a security review and ship it.

**Decided / dropped:**

- Auth errors are fixed text picked by status (wrong login, rate limit, bad input, network), never the server's own text.
- Sign-up signs in as a second step, because auto sign-in is off on the server; if that step fails, the form suggests logging in instead, so it doesn't reveal whether an account exists.
- The login redirect only follows `?next=` through the shared `safeNextPath` check, tested with outside URLs.
- Each pending document polls itself, so leaving the page or a document finishing stops its timer. Polls wait twice as long after each failure, up to 30 s, and stop on a 404.
- Files are checked before upload (`.txt`, `.md` or `.pdf`, not empty, under 4 MB minus room for the other form fields), and the title is prefilled from the file name.
- Moved the upload request into its own `uploadDocument()` function, tested in Node, instead of testing multipart inside the form's jsdom tests.
- Renamed the pasted-text box to "Pasted notes" because "Notes" clashed with the section heading for screen readers.

**Hardest part, and how I solved it:**
Testing the upload. In jsdom the form's request failed, because jsdom's `File` isn't the `File` that Node's `FormData` accepts, so the file came through as the text "[object File]". A real browser has only one `File`, so it was a test-environment problem, and the test config isn't mine to change. I moved the request into an `uploadDocument()` function tested in Node against the mocks with a real multipart body, and the form tests pass in a stand-in upload that records what the form would send.

**What I learned:**
How to write polling that can't leak: one timer per document, cleared and its request aborted on unmount, with backoff on errors. Fake timers let me check the exact delays (2 s, then 4, 8, 16, capped at 30) and that nothing fires after unmount. I also learned that two different `File` classes can exist in a test environment, and that moving the network call out of the component made both sides easier to test.
