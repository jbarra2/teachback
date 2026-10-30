---
name: start-task
description: Start a GitHub issue. Check it's ready, create the linked branch, read the spec, propose a plan including tests, then implement after approval.
argument-hint: <issue-number>
disable-model-invocation: true
allowed-tools: Bash(gh api user:*), Bash(gh issue view:*), Bash(gh issue develop:*), Bash(gh issue edit:*), Bash(git status:*), Bash(git fetch:*), Bash(git switch:*), Bash(git checkout:*), Bash(git pull:*), Bash(git merge:*), Bash(git branch:*), Bash(docker compose ps:*), Bash(npm run db:up), Bash(npm run db:update), Bash(npm run api:types)
---

Start issue #$ARGUMENTS.

If no issue number was given, do the `/next-task` steps and ask me which one. Stop.

## 1. Check it's ready

- `git status`: if there are uncommitted changes, stop and ask (finish, stash or discard).
- `gh issue view $ARGUMENTS --json number,title,body,state,assignees,labels,milestone`
  - It must be open. If it's not assigned to me (`gh api user --jq .login`), ask before continuing.
  - Every issue in the body's "Blocked by" list must be CLOSED (`gh issue view <m> --json state`). Otherwise stop, list the blockers and suggest `/next-task`.

## 2. Branch and environment

- `git switch main && git pull --ff-only`
- `gh issue develop $ARGUMENTS --checkout`. If a branch already exists, switch to it and `git merge main`.
- `gh issue edit $ARGUMENTS --add-label in-progress`
- If `package.json` exists: make sure the DBs are up (`docker compose ps`; if not, `npm run db:up`), then `npm run db:update`, and `npm run api:types` if the script exists. If Docker isn't running, tell me to start Docker Desktop.

## 3. Understand

- Read the goal and acceptance criteria.
- From `docs/PLAN.md`, read the issue's "Spec" sections plus §2 and §4. From `docs/TESTING.md`, read §1 and §3, plus any sections the issue references.
- For API work, read the relevant operations in `openapi/openapi.yaml`.
- Read the existing code this task touches. Track = the issue's label.

## 4. Propose a plan (no edits yet)

- **Goal:** one line.
- **Files:** to create or change. All must be in my track's folders; flag anything outside and any protected file.
- **Approach:** a short bullet for each acceptance criterion.
- **Tests:**
  - unit tests
  - integration tests, listing **each security matrix row (S1–S9)** that applies to each route
  - failure-mode tests (TESTING §6)
  - component tests for UI
- **Security & stability notes:** auth/ownership, input limits, error handling, transactions, rate limits. Anything risky.
- **Manual check:** how I'll verify it.
- **Questions/risks:** e.g. a needed contract or schema change → ask the lead; don't do it.

Ask: "Reply **go** to start, or tell me what to change." Wait.

## 5. Build (after "go")

- Implement in small steps and **write the tests alongside the code**. If the plan needs to change, say so first.
- Check installed library APIs (types and README in `node_modules`) before integration code.
- Run `npm run check` often, and `npm run test:int` for API work. Fix what breaks. Never weaken a test or a rule to get green.
- When done, give a 3–5 line summary, then: "Next: `/test-task`."
