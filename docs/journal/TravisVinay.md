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

## T25 · Concept map UI (#25) · Nov 2, 2026

<!-- needs-review -->

**What I built:** The `/courses/[courseId]/map` page: a read-only graph of the course's concepts, laid out top to bottom so a concept sits below the ones that lead to it. Each node shows the concept's name, a state-coloured border and a badge with the state in words, and links to practice for that concept. A legend and an "All concepts" text list mean the map doesn't rely on colour alone. The layout lives in `src/components/map/layout.ts`, the map in `concept-map.tsx`, with loading, error-with-retry and empty states.

**Skills & tools:** React Flow (`@xyflow/react`), dagre graph layout (`@dagrejs/dagre`), React 19 client components and effects with `AbortController`, openapi-fetch typed client with mocks, Next.js 16 async `params`, Tailwind CSS, Vitest + Testing Library (jsdom)

**Asked Claude for:** Build T25 from the issue's acceptance criteria with a plan and tests first, then verify it, run a security review and ship it.

**Decided / dropped:**

- Built the full React Flow + dagre map rather than the issue's fallback grid of cards, since there was time.
- Pinned both new packages to exact versions, and checked they're MIT, recently released and have no install scripts.
- `layoutMap` drops edges to unknown concepts, self-loops and duplicates, so bad data from the API can't break the layout. dagre handles cycles itself.
- Gave every node a fixed width and height instead of letting React Flow measure them, so nodes show and fit on the first paint.
- Made the map read-only (no dragging, connecting or selecting) and turned off focus on React Flow's node wrappers, so keyboard users get one tab stop per concept: the link inside it.
- The map renders only on the client after the data loads, so React Flow's inline styles are set from JavaScript and don't clash with the nonce-based CSP.

**Hardest part, and how I solved it:**
My render tests couldn't find any of the node links, even though the data loaded. React Flow keeps nodes hidden until it has measured them, and jsdom never measures anything. Giving each node a known `width` and `height` in the layout counts as measured, so the nodes render straight away in tests and in the browser. It also let me drop an inline size style on the node's link in favour of a `size-full` class.

**What I learned:**
Libraries that depend on layout measurement need extra setup in jsdom: React Flow needed `ResizeObserver` and `DOMMatrixReadOnly` stubs, and nodes with known sizes. I also learned to test a layout by its properties (with 100 concepts, no two nodes overlap and every edge points downward) rather than exact coordinates, which would break on any dagre update.
