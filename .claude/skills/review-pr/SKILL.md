---
name: review-pr
description: Security-focused review of a teammate's pull request against its issue, the spec and team rules. Drafts a review for me to post.
argument-hint: <pr-number>
disable-model-invocation: true
allowed-tools: Bash(gh pr view:*), Bash(gh pr diff:*), Bash(gh pr checks:*), Bash(gh issue view:*), Bash(git status:*), Bash(git branch:*)
---

Review PR #$ARGUMENTS. Read-only unless I say otherwise.

1. `gh pr view $ARGUMENTS --json title,body,author,headRefName,files,closingIssuesReferences`, then `gh issue view` on the linked issue (acceptance criteria, track, spec).
2. `gh pr diff $ARGUMENTS` and `gh pr checks $ARGUMENTS`. If `ci-ok` or CodeQL is red, say so first.
3. **Review**, in priority order:
   - **Security** (docs/TESTING.md §8 checklist):
     - routes wrapped in `withApi`; queries scoped to the user (look for IDOR)
     - input validated with `.strict()` zod schemas that match `openapi.yaml`
     - limits enforced; output rendered as text (no `dangerouslySetInnerHTML`)
     - no secrets, and no sensitive data in logs or responses; errors generic
     - uploads validated
     - Claude prompts wrap untrusted data; model output never executed or rendered as HTML
     - new dependencies meet TESTING §5
   - **Tests:**
     - the security matrix (S1–S9) is present for every changed route
     - failure modes and regression tests exist
     - nothing skipped or weakened; coverage thresholds unchanged
     - tests actually assert behaviour (not just "doesn't throw")
   - **Correctness & stability:** logic bugs, edge cases, transactions, race conditions, stuck states, error handling, UI loading/error states.
   - **Team rules:** ownership (PLAN §2), protected files, scope creep, PR template filled, test evidence and `/security-review` result included, no AI attribution.
   - **Journal** (`docs/journal/*.md`): only the author's own file changed; no keys, `.env` values or personal details (🔴 if found). Don't comment on the wording. A missing entry is a 🟢 nit.
   - **Readability:** naming, dead code, debug leftovers.
4. **Draft the review:**
   - a summary and a recommendation (**Approve** / **Request changes**)
   - comments as `path:line`, each tagged 🔴 must fix / 🟡 should fix / 🟢 nit
   - any security issue is 🔴
5. **Optional local run** (if I ask): check `git status` is clean, then `gh pr checkout $ARGUMENTS`, `npm ci`, `npm run db:update`, `npm run verify`. Give abuse-check steps, then `git switch -` and `npm ci` to restore.
6. Ask me what to post. Only after I confirm, run `gh pr review $ARGUMENTS --approve|--request-changes|--comment --body-file -` with the body on stdin.
