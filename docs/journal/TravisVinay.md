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
