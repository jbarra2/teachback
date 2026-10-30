Closes #

## What changed

-

## How to test

1.

## Test evidence

<!-- Paste the `npm run verify` summary and coverage % -->

**Security matrix** (docs/TESTING.md §3). One row per route added or changed. Write n/a if there are no API changes.

| Route | S1  | S2  | S3  | S4  | S5  | S6  | S7  | S8  | S9  |
| ----- | --- | --- | --- | --- | --- | --- | --- | --- | --- |

## Security

- `/security-review` result: <!-- "no findings" or list each finding + how it was fixed/why it's not an issue -->
- Risky areas touched (auth, uploads, AI prompts, data access): <!-- none / describe -->

## Screenshots (UI changes)

## Checklist

- [ ] Does what the issue's acceptance criteria say, nothing extra
- [ ] Only my track's folders; no protected files (`openapi.yaml`, `prisma/`, `src/lib/schemas/`) unless the issue says so
- [ ] Tests written with the code: happy path, error paths, security matrix for every route
- [ ] Nothing weakened: no skipped tests, `eslint-disable`, `@ts-ignore`, `any`, or lowered thresholds
- [ ] `npm run verify` passes locally
- [ ] I ran it myself, including the abuse checks from `/test-task`
- [ ] No secrets, `.env`, or sensitive logging

## New packages

None
