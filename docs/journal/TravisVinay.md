# Work journal: Travis Vinay (@TravisVinay)

**Role:** Frontend on TeachBack, a Next.js app that grades students' explanations against their own notes.

One entry per task, oldest first.

## T19 · Mastery module (pure functions) (#19) · Nov 1, 2026

<!-- needs-review -->

**What I built:** The scoring rules behind the concept map, as pure functions in `src/lib/mastery/`:

- `applyResult` moves a concept's score halfway toward each answer's result.
- `masteryState` labels a concept MASTERED, REVIEW or PRACTICE.
- `selectNextConcept` picks which concept to practise next.

The answer service and the map UI both build on them.

**Skills & tools:** TypeScript (pure functions, `Record` lookups typed from the generated API contract), sorting with multi-key comparators, floating-point arithmetic, Vitest (table-driven tests, coverage reports)

**Asked Claude for:** Start T19 while my other two PRs waited for the lead's review, following PLAN §9 and the issue's test list.

**Decided / dropped:**

- A LOW-confidence grade changes nothing, not even the attempt count, so a shaky grade can't count toward the two attempts MASTERED needs.
- `applyResult` takes the Feedback's `verdict` and `confidence` directly, so the answer service (T24) can pass them through, rather than a bare 0 / 0.5 / 1.
- Added the concept id as a final tie-break, so the next concept doesn't depend on the order the list arrives in.
- Took the verdict, confidence and state types from the generated `schema.d.ts`, so they can't drift from the contract.
- Left the atomic SQL update from PLAN §9 to the answer service; these functions are the reference it should match.

**Hardest part, and how I solved it:**
One test failed with `0.6000000000000001` instead of `0.6`. The code was right, but 0.2 can't be stored exactly in binary floating point, so `0.2 + 0.5 × (1 − 0.2)` came out slightly off. I changed the test to start from 0.25, where every step is exact, and used `toBeCloseTo` where a score only approaches a value (always-partial heading toward 0.5). Separately, the full verify once timed out in a repo-scanning tooling test I don't own. It passed alone in under two seconds, so I re-ran verify instead of raising its timeout.

**What I learned:**
Numbers like 0.25, 0.5 and 0.75 are exact in floating point, but 0.1 and 0.2 aren't, so exact comparisons in tests should use values that are exact, or `toBeCloseTo`. I also learned to turn a spec's worked examples straight into table-driven tests: the boundary rows (0.3999 vs 0.4, 0.7499 vs 0.75, 0.75 with only one attempt) are what pin the rules down.
