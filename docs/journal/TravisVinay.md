# Work journal: Travis Vinay (@TravisVinay)

**Role:** Frontend on TeachBack, a Next.js app that grades students' explanations against their own notes.

One entry per task, oldest first.

## T09 · Typed API client (openapi-fetch) + per-endpoint mocks (#9) · Nov 1, 2026

<!-- needs-review -->

**What I built:** A typed API client for every screen (`src/lib/api-client/`), built on `openapi-fetch` and the types generated from `openapi.yaml`. Failed calls become one `ApiError { code, message, status }`, and a 401 sends the browser to `/login?next=…`. I also built typed mocks in `src/lib/mocks/`. `NEXT_PUBLIC_MOCK_ENDPOINTS` turns them on per endpoint, so the UI can be built before the backend exists.

**Skills & tools:** TypeScript (generics, conditional types, `satisfies`), openapi-fetch, openapi-typescript, Fetch API (`Request`/`Response`), Vitest (fake timers, `vi.stubGlobal`, `vi.stubEnv`)

**Asked Claude for:** Build T09 from the issue's acceptance criteria. Keep long checks running in the background without asking each time.

**Decided / dropped:**

- Mocks plug in through openapi-fetch's custom `fetch` option instead of a separate fake client, so mocked and real calls share the same typed client, error mapping and 401 handling.
- Mock fixtures use `satisfies` with the generated schema types, so a contract change breaks the build instead of silently drifting.
- Added a client-only `NETWORK_ERROR` code for requests that never get an answer, because the contract's error codes all assume a server response.
- Kept the client browser-only for now. Loading data in server components is a follow-up for T05/T15.
- Dropped `window.location.assign("/login…")` with a relative string because Next's lint rule rejects it. The redirect builds an absolute `URL` on the same origin instead.

**Hardest part, and how I solved it:**
After writing the tests, `tsc` said the data returned by `unwrap()` was "possibly undefined" everywhere. TypeScript was inferring the data type from openapi-fetch's result union, and the error branch (`data?: never`) added `undefined` to it. I changed `unwrap` to infer the whole result type and return `Exclude<R["data"], undefined>`. That strips `undefined` but keeps `null`, which the next-concept endpoint really returns.

**What I learned:**
How type inference over a union can pick up `undefined` from the branch you don't care about, and how a conditional type like `Exclude` fixes the return type without casting at every call site. I also learned that routing mocks through the real client's `fetch` hook tests more of the real code path than a hand-written fake. I'd use the same pattern whenever the backend lags behind the UI.
