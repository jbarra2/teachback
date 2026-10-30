# TeachBack: Project Plan (spec)

Notes that teach you back. Students upload lecture notes, explain concepts in their own words, get feedback grounded in their notes (Claude API), and see a concept map of what to review next.

- **Deadline:** submit Sun Nov 8, 2026. **Work stops Sat Nov 7 at night.** Sunday is the lead's submission prep only.
- **Required deliverable:** the repo (public) and a README. A live deployment is a stretch goal.
- **Tasks live in GitHub Issues** (created from `scripts/backlog.json`). This file is the spec those issues reference ("PLAN §n"). Testing and security: `docs/TESTING.md`. Workflow: `CONTRIBUTING.md`. Claude's rules: `CLAUDE.md`.

---

## §1 Product & scope

**Core loop:** upload notes → app extracts concepts → pick a concept → app asks a question → student explains → feedback grounded in the notes (verified quotes + confidence) → concept map updates (Mastered / Review / Practice) → "Practice weakest" picks the next concept.

**Differentiator:** it makes students _explain_, its feedback _cites their own notes_, and it _says when it isn't sure_.

**In scope (MVP):**

- Email/password accounts
- Courses; notes import (paste, `.txt`, `.md`, text-based PDF)
- Concept extraction linked to source passages
- Practice with grounded feedback; saved attempts; per-concept mastery
- Concept map; "Practice weakest"
- API docs (Scalar)
- Security baseline (TESTING §8)
- README a grader can follow

**Cut to fit the schedule:** background worker (replaced by Next.js `after()`), Docker production image, dispute button, session summaries, edge types, OAuth, spaced repetition, OCR, sharing, mobile app.

---

## §2 Team & ownership

Only edit your track's folders. Need a change elsewhere? Comment on your issue and tag the owner.

| Track (label)                                            | Owns                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Lead** (`lead`): platform, data, security, integration | `openapi/`, `prisma/` (except `seed.ts`), `prisma.config.ts`, `src/lib/db.ts`, `src/lib/schemas/`, `src/lib/auth.ts`, `src/lib/auth-client.ts`, `src/lib/api/`, `src/lib/log.ts`, `src/lib/rate-limit.ts`, `src/lib/services/courses.ts`, `src/lib/services/map.ts`, `src/app/api/{auth,courses,health,openapi,docs}/`, `src/proxy.ts`, root config files (`next.config.ts`, `tsconfig.json`, ESLint/Prettier/Vitest/Playwright configs), `tests/helpers/`, `tests/contract/`, `scripts/` (except AI scripts), `.github/`, `.githooks/`, `.claude/`, `docs/` (except `docs/eval.md` and teammates' journals), `docker-compose.yml`, `README.md` |
| **AI** (`ai`): Claude API, ingestion, grading            | `src/lib/ai/`, `src/lib/ingest/`, `src/lib/services/{documents,questions,answer}.ts`, `src/app/api/{documents,concepts,questions}/`, `prisma/seed.ts`, `tests/e2e/`, `fixtures/`, `scripts/{ai-ping,eval}.ts`, `docs/eval.md`                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **Frontend** (`frontend`): every screen                  | `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/globals.css`, `src/app/(auth)/`, `src/app/(app)/`, `src/components/`, `src/lib/api-client/` (except the generated `schema.d.ts`), `src/lib/mocks/`, `src/lib/mastery/` (T19)                                                                                                                                                                                                                                                                                                                                                                                                                 |

**Everyone:** your own `docs/journal/<your-github-username>.md`. `/finish-task` adds an entry with each task (see `docs/JOURNAL.md`).

**Shared:** `package.json` and `package-lock.json`. Any task may add the dependencies it needs (list them in the PR). On a lockfile merge conflict, run `git checkout origin/main -- package-lock.json && npm install`, then commit.

**Protected (lead only, in their own small PRs):** `openapi/openapi.yaml`, `prisma/schema.prisma`, `prisma/migrations/`, `src/lib/schemas/`. Request changes by commenting on your issue. An issue may explicitly grant an exception.

---

## §3 Tech stack

| Concern          | Choice                                                                                                                    | Notes                                                                                                                                                                                     |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Framework        | Next.js 16+ (App Router, TypeScript, `src/`)                                                                              | Interception in `src/proxy.ts`. Don't enable `cacheComponents`.                                                                                                                           |
| Database         | PostgreSQL 17 in **local Docker**                                                                                         | `db` on 127.0.0.1:5433 (persistent), `db-test` on 127.0.0.1:5434 (tmpfs, for tests). `npm run db:up`.                                                                                     |
| ORM              | Prisma 7+                                                                                                                 | `prisma-client` generator → `src/generated/prisma`. `prisma.config.ts` uses `DIRECT_URL`. Runtime uses `@prisma/adapter-pg` with `DATABASE_URL`. Import from `@/generated/prisma/client`. |
| Auth             | Better Auth (email + password, Prisma adapter)                                                                            | `src/app/api/auth/[...all]/route.ts`                                                                                                                                                      |
| API contract     | **Hand-written `openapi/openapi.yaml`** (OpenAPI 3.1) + **Scalar** UI at `/api/docs`                                      | Redocly CLI lint. Client types via `openapi-typescript`. Typed client via `openapi-fetch`. Tests validate responses against the spec with Ajv.                                            |
| Validation       | zod v4 (`.strict()`)                                                                                                      | Server-side request validation, mirroring the spec                                                                                                                                        |
| AI               | Claude API via `@anthropic-ai/sdk`                                                                                        | Structured outputs (§8). `AI_PROVIDER=fake` in dev, tests and CI.                                                                                                                         |
| Background work  | Next.js `after()`                                                                                                         | Document processing after the upload response                                                                                                                                             |
| UI               | Tailwind CSS (shadcn/ui optional) · React Flow (`@xyflow/react`) + dagre                                                  |                                                                                                                                                                                           |
| PDF text         | `unpdf`                                                                                                                   | Text-based PDFs only                                                                                                                                                                      |
| Tests            | Vitest (unit + integration), Testing Library, Playwright, Ajv                                                             | See `docs/TESTING.md`                                                                                                                                                                     |
| Security tooling | ESLint security rules, git hooks (secret scan), gitleaks, `npm audit`, CodeQL, Dependabot, Claude Code `/security-review` | See `docs/TESTING.md` §2                                                                                                                                                                  |
| Tooling          | Node 22+, npm, Prettier (LF), tsx                                                                                         | Cross-platform: Windows + macOS                                                                                                                                                           |
| CI               | GitHub Actions (`ci.yml`) + CodeQL default setup                                                                          | Required checks: `ci-ok` and CodeQL                                                                                                                                                       |
| Deploy (stretch) | Vercel Hobby + Neon Free (production DB only)                                                                             | `docs/DEPLOY.md`                                                                                                                                                                          |

---

## §4 Architecture & conventions

```
Browser (React; client components only where needed)
   │  openapi-fetch client (types generated from openapi/openapi.yaml)
   ▼
src/proxy.ts            ← CSP nonce + security headers, signed-out page redirects
   ▼
Route handlers  src/app/api/**  wrapped in withApi()
   │  auth (401) · Origin check (403) · body limit (413) · rate limit (429) · zod (400) · safe errors (500 + request id)
   ▼
Services & domain  src/lib/{services,ai,ingest,mastery}
   ▼                         └── Claude API (src/lib/ai/provider.ts only)
Prisma → PostgreSQL (Docker)
```

**Upload flow:** `POST /api/documents` → `extractText` (validates type, size, encoding) → save Document (QUEUED) → `runAfterResponse(() => processDocument(id))` → 202. `processDocument`: PROCESSING → chunk and call Claude **outside** any transaction → then one short transaction saves chunks, concepts, links and edges and sets READY (or FAILED + friendly error). Never hold a DB transaction open during an AI call. Anything QUEUED or PROCESSING for more than 10 min reads as FAILED. The UI polls `GET /api/documents/:id`.

**Answer flow:** `POST /api/questions/:id/answer` → `services/answer.ts` → `evaluateAnswer` → `verifyEvidence` → one transaction: save Attempt + apply mastery (row-locked) → feedback + `{ state, score }`.

### Conventions

- **Every** API route is wrapped in `withApi()`. Handlers do only: parse with the zod schema → call **one** service → return contract-shaped JSON.
- **No Prisma in components or route handlers** (enforced by lint). Services own data access.
- **Ownership:** every query is scoped to the signed-in user. Another user's resource returns **404**.
- **Errors:** `{ error: { code, message, details? } }`. 500s are generic and carry `x-request-id`.
- **Testable handlers:** route handlers read everything from the `Request` (headers, cookies, body). Never call `next/headers`/`cookies()` in API code. Tests then call the exported `GET`/`POST` functions directly with a constructed `Request` and `{ params: Promise.resolve({...}) }`.
- **Background work** goes through `runAfterResponse(fn)` in `src/lib/api/background.ts`. It uses Next's `after()` in the app and runs inline (awaitable) in tests.
- **CSRF rule** (in `withApi`): reject a mutating request if its `Origin` header is present and isn't the app origin, or if `Sec-Fetch-Site` is `cross-site`. Requests with neither header (curl, Postman, tests) are allowed, since CSRF needs a browser.
- Next 16 params are async: `const { id } = await params`.
- All Claude calls go through `src/lib/ai/provider.ts`. All logging goes through `src/lib/log.ts`.
- User-supplied text is rendered as text. Never use `dangerouslySetInnerHTML`.
- Change the API = change `openapi/openapi.yaml` first (lead), then `npm run api:types`.

---

## §5 Folder structure

```
openapi/openapi.yaml                      API contract (source of truth)
src/
  app/
    (auth)/login, (auth)/signup
    (app)/courses, (app)/courses/[courseId], .../practice, .../map
    api/auth/[...all]/route.ts
    api/health/route.ts
    api/openapi/route.ts, api/docs/route.ts   spec + Scalar (when API_DOCS_ENABLED=true)
    api/courses/route.ts, api/courses/[id]/route.ts
    api/courses/[id]/{concepts,map,next-concept}/route.ts
    api/documents/route.ts, api/documents/[id]/route.ts
    api/concepts/[id]/question/route.ts
    api/questions/[id]/answer/route.ts
  components/{ui,notes,practice,map}/
  lib/
    schemas/       zod request schemas (mirror openapi.yaml)
    api/           withApi(), errors, request id, background.ts (runAfterResponse)
    db.ts, auth.ts, auth-client.ts, log.ts, rate-limit.ts
    services/      courses.ts, map.ts · documents.ts, questions.ts, answer.ts
    ingest/        extract-text.ts, chunk.ts, process-document.ts
    ai/            provider.ts, fake.ts, prompts/, extract-concepts.ts,
                   generate-question.ts, evaluate-answer.ts, verify-evidence.ts
    mastery/       score.ts, select-next.ts
    api-client/    client.ts (openapi-fetch), schema.d.ts (generated), mock switch
    mocks/         fixtures (deleted in T28)
  generated/prisma/ (gitignored)
  proxy.ts
prisma/schema.prisma, prisma/migrations/, prisma/seed.ts
tests/helpers/, tests/contract/ (lead) · tests/e2e/ (AI track, T29)
fixtures/notes/, fixtures/eval/
scripts/   setup.mjs, verify.mjs, install-hooks.mjs, hooks/, setup-github.mjs, backlog.json, ai-ping.ts, eval.ts
docs/      PLAN.md, TESTING.md, DEPLOY.md, JOURNAL.md, eval.md; journal/<github-username>.md (one per person)
```

---

## §6 Data model (Prisma)

Auth models (`User`, `Session`, `Account`, `Verification`) come from the Better Auth CLI. Add these relation fields to `User`: `courses Course[]`, `attempts Attempt[]`, `mastery Mastery[]`.

```prisma
generator client {
  provider = "prisma-client"
  output   = "../src/generated/prisma"
}

datasource db {
  provider = "postgresql"   // URL comes from prisma.config.ts
}

enum DocumentStatus { QUEUED PROCESSING READY FAILED }
enum SourceType     { TEXT MARKDOWN PDF }
enum QuestionKind   { EXPLAIN WHY COMPARE APPLY }
enum Verdict        { CORRECT PARTIAL INCORRECT }
enum Confidence     { HIGH MEDIUM LOW }

model Course {
  id        String     @id @default(cuid())
  userId    String
  user      User       @relation(fields: [userId], references: [id], onDelete: Cascade)
  name      String     @db.VarChar(120)
  createdAt DateTime   @default(now())
  documents Document[]
  concepts  Concept[]
  @@index([userId])
}

model Document {
  id         String         @id @default(cuid())
  courseId   String
  course     Course         @relation(fields: [courseId], references: [id], onDelete: Cascade)
  title      String         @db.VarChar(200)
  sourceType SourceType
  rawText    String
  status     DocumentStatus @default(QUEUED)
  error      String?
  createdAt  DateTime       @default(now())
  updatedAt  DateTime       @updatedAt
  chunks     Chunk[]
  @@index([courseId])
}

model Chunk {
  id         String         @id @default(cuid())
  documentId String
  document   Document       @relation(fields: [documentId], references: [id], onDelete: Cascade)
  order      Int
  text       String
  refLabel   String
  concepts   ConceptChunk[]
  @@unique([documentId, order])
}

model Concept {
  id        String         @id @default(cuid())
  courseId  String
  course    Course         @relation(fields: [courseId], references: [id], onDelete: Cascade)
  name      String
  nameKey   String         // normalized name (lowercase, collapsed spaces): dedupe + merge key
  summary   String
  createdAt DateTime       @default(now())
  chunks    ConceptChunk[]
  outEdges  ConceptEdge[]  @relation("EdgeFrom")
  inEdges   ConceptEdge[]  @relation("EdgeTo")
  questions Question[]
  mastery   Mastery[]
  @@unique([courseId, nameKey])
}

model ConceptChunk {
  conceptId String
  chunkId   String
  concept   Concept @relation(fields: [conceptId], references: [id], onDelete: Cascade)
  chunk     Chunk   @relation(fields: [chunkId], references: [id], onDelete: Cascade)
  @@id([conceptId, chunkId])
}

model ConceptEdge {
  id     String  @id @default(cuid())
  fromId String
  toId   String
  from   Concept @relation("EdgeFrom", fields: [fromId], references: [id], onDelete: Cascade)
  to     Concept @relation("EdgeTo",   fields: [toId],   references: [id], onDelete: Cascade)
  @@unique([fromId, toId])
}

model Question {
  id             String       @id @default(cuid())
  conceptId      String
  concept        Concept      @relation(fields: [conceptId], references: [id], onDelete: Cascade)
  text           String
  kind           QuestionKind
  sourceChunkIds String[]
  createdAt      DateTime     @default(now())
  attempts       Attempt[]
}

model Attempt {
  id         String     @id @default(cuid())
  userId     String
  user       User       @relation(fields: [userId], references: [id], onDelete: Cascade)
  questionId String
  question   Question   @relation(fields: [questionId], references: [id], onDelete: Cascade)
  answer     String     @db.VarChar(4000)
  verdict    Verdict
  confidence Confidence
  feedback   Json
  createdAt  DateTime   @default(now())
  @@index([userId, createdAt])
}

model Mastery {
  userId     String
  conceptId  String
  user       User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  concept    Concept   @relation(fields: [conceptId], references: [id], onDelete: Cascade)
  score      Float     @default(0)
  attempts   Int       @default(0)
  lastSeenAt DateTime?
  @@id([userId, conceptId])
}

model ApiRateLimit {     // named to avoid clashing with Better Auth's own rateLimit model
  key         String    // "<userId>:<bucket>:<window>"
  windowStart DateTime
  count       Int       @default(0)
  @@id([key, windowStart])
}
```

---

## §7 API contract (`openapi/openapi.yaml` is the source of truth)

All requests and responses are JSON under `/api`, using a cookie session (Better Auth). The table is a summary; the spec wins if they disagree.

| Method | Path                             | Request                                              | Success                                                      | Notes                           |
| ------ | -------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------ | ------------------------------- |
| GET    | `/api/health`                    | –                                                    | `{ status, db }`                                             | Public                          |
| GET    | `/api/openapi` · `/api/docs`     | –                                                    | spec · Scalar UI                                             | Only if `API_DOCS_ENABLED=true` |
| GET    | `/api/courses`                   | –                                                    | `Course[]`                                                   |                                 |
| POST   | `/api/courses`                   | `{ name }`                                           | 201 `Course`                                                 |                                 |
| GET    | `/api/courses/{id}`              | –                                                    | `Course` + `documents[{ id, title, status, createdAt }]`     |                                 |
| GET    | `/api/courses/{id}/concepts`     | –                                                    | `[{ id, name, summary, state, score, attempts }]`            |                                 |
| POST   | `/api/documents`                 | multipart: `courseId`, `title`, `file` **or** `text` | 202 `{ id, status }`                                         | rate limit `upload`             |
| GET    | `/api/documents/{id}`            | –                                                    | `{ id, status, error?, conceptCount }`                       |                                 |
| POST   | `/api/concepts/{id}/question`    | –                                                    | `{ questionId, text, kind, sources[{ chunkId, refLabel }] }` | rate limit `ai`                 |
| POST   | `/api/questions/{id}/answer`     | `{ answer }`                                         | `{ attemptId, feedback, mastery{ state, score } }`           | rate limit `ai`                 |
| GET    | `/api/courses/{id}/map`          | –                                                    | `{ nodes[{ id, name, state, score }], edges[{ from, to }] }` |                                 |
| GET    | `/api/courses/{id}/next-concept` | –                                                    | `{ conceptId, name, state }` or `null`                       |                                 |

**Limits:**

| Field            | Limit                        |
| ---------------- | ---------------------------- |
| Course `name`    | 1–120 chars                  |
| Document `title` | 1–200 chars                  |
| `answer`         | 1–4000 chars                 |
| Upload           | ≤ `MAX_UPLOAD_MB` (4)        |
| Extracted text   | ≤ `MAX_NOTE_CHARS` (200,000) |
| JSON body        | ≤ 64 KB                      |
| Ids              | cuid format                  |
| Unknown fields   | rejected                     |

**Errors:** `{ "error": { "code", "message", "details"? } }`

| Code              | Status                 |
| ----------------- | ---------------------- |
| VALIDATION_ERROR  | 400                    |
| UNSUPPORTED_TYPE  | 400                    |
| UNAUTHENTICATED   | 401                    |
| FORBIDDEN_ORIGIN  | 403                    |
| NOT_FOUND         | 404                    |
| PAYLOAD_TOO_LARGE | 413                    |
| UNREADABLE_FILE   | 422                    |
| RATE_LIMITED      | 429 (+ `Retry-After`)  |
| INTERNAL          | 500 (+ `x-request-id`) |
| AI_UNAVAILABLE    | 502                    |

`state` is one of `MASTERED`, `REVIEW` or `PRACTICE`. Mock keys for `NEXT_PUBLIC_MOCK_ENDPOINTS`: `courses`, `documents`, `concepts`, `question`, `answer`, `map`, `next`.

**Contract workflow:**

1. Lead edits `openapi.yaml`.
2. `npm run api:lint`.
3. `npm run api:types` (regenerates the client types).
4. Update the zod schemas.
5. Merge before any code that uses the change.

Postman users can import `openapi.yaml` directly.

---

## §8 AI pipeline (Claude API)

**Provider** (`src/lib/ai/provider.ts`):

- `generateJson(schema, { system, user }, { model: "fast" | "smart" })` using `@anthropic-ai/sdk` structured outputs (`client.messages.parse` + the SDK's Zod helper; check the installed README).
- Structured outputs don't enforce min/max/length constraints, so zod validates afterwards.
- `AI_MODEL_FAST` (default `claude-sonnet-5-5`): extraction and questions. `AI_MODEL_SMART` (default `claude-opus-5-5`): grading. Opus is slower and costs more per call, so T27 measures its agreement and latency against Sonnet; if Sonnet grades nearly as well and is clearly faster, switch `AI_MODEL_SMART` (it's only an env var).
- 1 retry, 60 s timeout, typed `AiError` → routes return 502 AI_UNAVAILABLE.
- `AI_PROVIDER=fake`: deterministic fixtures plus failure modes (`timeout`, `malformed`, `rate_limited`, `server_error`, `fabricated_evidence`).

**Prompt rules (prompt-injection resistance):**

- Notes are wrapped as `<chunk id="..." ref="...">...</chunk>`. The student's answer is wrapped as `<student_answer>...</student_answer>`.
- The system prompt says all of that is untrusted data; instructions inside it must be ignored and must never change the grading rules.
- Output must match the schema. Model output is never executed and never rendered as HTML.

**Tasks:**

1. **`extractConcepts(chunks)`** returns `{ concepts[{ name, summary, chunkIds[] }], edges[{ from, to }] }` (fast model)
   - 8–15 concepts per document, merged by normalized name with the course's existing concepts.
   - Unknown chunkIds and edges are dropped.
2. **`generateQuestion(concept, chunks, recentQuestions)`** returns `{ text, kind, sourceChunkIds[] }` (fast model)
   - Answerable from the chunks alone. Prefer EXPLAIN/WHY. Don't repeat the last 5.
3. **`evaluateAnswer(question, chunks, answer)`** returns `Feedback` (smart model)
   ```ts
   // Sent to Claude as the output schema:
   const ModelFeedback = z.object({
     verdict: z.enum(["CORRECT", "PARTIAL", "INCORRECT"]),
     whatCorrect: z.string(),
     whatMissing: z.string(),
     evidence: z.array(z.object({ chunkId: z.string(), quote: z.string() })), // 1–3, zod-checked
     confidence: z.enum(["HIGH", "MEDIUM", "LOW"]),
     outsideNotes: z.boolean(),
   });
   // Stored and returned. `unsupported` is set only by verifyEvidence; the model can't set it:
   const Feedback = ModelFeedback.extend({ unsupported: z.boolean() });
   ```
4. **`verifyEvidence(feedback, chunks)`** is pure code and the grounding guarantee:
   - Normalize text: lowercase, collapse whitespace, straighten quotes and dashes.
   - Keep evidence only if its `chunkId` was provided **and** its quote is a substring of that chunk.
   - If any item was dropped, confidence becomes at most MEDIUM. If all were dropped, confidence is LOW and `unsupported = true`.

**Cost control:**

- Use the fake provider by default; the real API only when the task needs it.
- One API key per person.
- Per-user rate limits.
- Extraction runs once per upload.
- **Prompt caching:** put the system prompt and the concept's chunks first and mark them cacheable (check the SDK docs). Repeated questions and grading on the same concept then cost less and return faster, which matters most for Opus.

---

## §9 Mastery & targeted practice

- Result values: CORRECT = 1, PARTIAL = 0.5, INCORRECT = 0.
- Update rule: `score ← score + 0.5 × (result − score)`, `attempts += 1`, `lastSeenAt = now`.
- **LOW confidence doesn't change mastery.**
- States:
  - **MASTERED:** `score ≥ 0.75` and `attempts ≥ 2`
  - **REVIEW:** `attempts ≥ 1` and `score ≥ 0.4`
  - **PRACTICE:** everything else, including unseen concepts
- Worked examples:
  - From 0, two correct answers: 0.5, then 0.75 → MASTERED.
  - From 0, always partial: 0.25 (PRACTICE) → 0.375 (PRACTICE) → 0.4375 (REVIEW) → approaches 0.5 and is never MASTERED.
  - A wrong answer at 0.75 drops to 0.375 → PRACTICE.
- **Next concept:** PRACTICE before REVIEW before MASTERED. Within a state, lowest score first, then oldest `lastSeenAt` (unseen first). Skip the previous concept unless it's the only one.
- **Concurrency-safe update:** one atomic statement in the same transaction as the Attempt: `INSERT … ON CONFLICT (userId, conceptId) DO UPDATE SET score = score + 0.5 * (r - score), attempts = attempts + 1, lastSeenAt = now() RETURNING score, attempts` via `$queryRaw` (tagged template). It works for the very first answer too, where there is no row to lock yet.
- The UI label for MASTERED is "Seems understood".

---

## §10 Environments & scripts

|                          | Database                                       | AI                | Env file                              |
| ------------------------ | ---------------------------------------------- | ----------------- | ------------------------------------- |
| **Local dev**            | Docker `db` (127.0.0.1:5433)                   | `fake` by default | `.env` (created by `npm run setup`)   |
| **Tests** (local + CI)   | Docker `db-test` (127.0.0.1:5434) / CI service | `fake`            | `.env.test` (committed, dummy values) |
| **Production (stretch)** | Neon `main` branch                             | `anthropic`       | Vercel env vars (`docs/DEPLOY.md`)    |

**npm scripts:**

| Script                                  | Command                                                                                           | Added in  |
| --------------------------------------- | ------------------------------------------------------------------------------------------------- | --------- |
| `setup`                                 | `node scripts/setup.mjs`                                                                          | T01       |
| `dev` / `build` / `start`               | Next.js                                                                                           | T01       |
| `verify`                                | `node scripts/verify.mjs` (full gate, mirrors CI)                                                 | T01       |
| `check`                                 | `npm run format:check && npm run lint && npm run typecheck && npm run test` (fast; pre-push)      | T01       |
| `format` / `format:check`               | `prettier --write .` / `prettier --check .`                                                       | T01       |
| `lint` / `typecheck`                    | `eslint . --max-warnings=0` / `next typegen && tsc --noEmit` (generates Next's route types first) | T01       |
| `test`                                  | `vitest run --project unit`                                                                       | T01       |
| `test:int`                              | `vitest run --project integration`                                                                | T07       |
| `test:ci`                               | unit only (T01), then `vitest run --coverage` (unit + integration + thresholds)                   | T01 → T07 |
| `test:e2e`                              | `playwright test`                                                                                 | T29       |
| `audit`                                 | `npm audit --omit=dev --audit-level=high`                                                         | T01       |
| `api:lint`                              | `redocly lint openapi/openapi.yaml`                                                               | T03       |
| `api:types`                             | `openapi-typescript openapi/openapi.yaml -o src/lib/api-client/schema.d.ts`                       | T03       |
| `api:types:check`                       | `npm run api:types && git diff --exit-code -- src/lib/api-client/schema.d.ts`                     | T03       |
| `db:up` / `db:down`                     | `docker compose up -d --wait db db-test` / `docker compose down`                                  | T01       |
| `db:migrate`                            | `prisma migrate dev` (lead only)                                                                  | T02       |
| `db:update`                             | `prisma migrate deploy && prisma generate`                                                        | T02       |
| `db:seed` / `db:studio` / `db:generate` | Prisma                                                                                            | T02 / T08 |
| `ai:ping` / `eval`                      | `tsx scripts/ai-ping.ts` / `tsx scripts/eval.ts`                                                  | T04 / T27 |
| `prepare`                               | `node scripts/install-hooks.mjs`                                                                  | T01       |
| `postinstall`                           | `prisma generate`                                                                                 | T02       |

---

## §11 Schedule (Oct 29 – Nov 7, 2026)

Evenings on weekdays, full days on weekends.

| Milestone             | Due       | Exit criteria                                                                                                             |
| --------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------- |
| **M1 Foundation**     | Sat 10/31 | Setup works, DB, contract, auth + `withApi`, test infra, AI wrapper, ingestion. Everyone unblocked.                       |
| **M2 Vertical slice** | Mon 11/2  | Security baseline + upload → concepts → question → submit, with security tests                                            |
| **M3 Core features**  | Thu 11/5  | Grounded feedback, mastery, map, practice weakest, mocks removed                                                          |
| **M4 Ship**           | Sun 11/8  | Eval, E2E security tests, polish, bug bash, README. **Work stops Saturday night;** Sunday is only T34 (submit on Canvas). |

### At a glance

| Date              | Lead                                                     | AI            | Frontend      |
| ----------------- | -------------------------------------------------------- | ------------- | ------------- |
| Thu 10/29 (night) | Repo + day-one files + issues, T01                       | –             | –             |
| Fri 10/30 (eve)   | Onboard team, T02, T03                                   | `/setup`, T04 | `/setup`, T05 |
| Sat 10/31         | T06, T07                                                 | T10, T11, T08 | T09, T15      |
| Sun 11/1          | T13, then T14 (after T12 merges)                         | T12           | T15, T16      |
| Mon 11/2 (eve)    | **T20 go/no-go**, reviews                                | T17, T18      | T16, T19      |
| Tue 11/3 (eve)    | T21, reviews                                             | T22           | T23           |
| Wed 11/4 (eve)    | Buffer: reviews, unblock, pair where behind              | T22, T24      | T25           |
| Thu 11/5 (eve)    | T28                                                      | T27           | T25, T26      |
| Fri 11/6 (eve)    | T28, T31 (stretch), reviews. **Feature freeze 11:59 PM** | T27, T29      | T30           |
| Sat 11/7          | T32, T33. **Stop at night**                              | T32 fixes     | T32 fixes     |
| Sun 11/8          | **T34: submit on Canvas**                                | –             | –             |

**Critical paths:**

- T01 → T03 → T09 → T16 → T23 → T28 → T29 → T32
- T04 → T17 → T22 → T24 → T28
- T10 → T11 → T12 → T14 → T17
- T06 → T07 → every API task

**After the freeze (Fri 11:59 PM):** bug fixes (with regression tests), README and docs only.

**Cut list** (in order, if behind at T20 or later):

1. T31 deploy
2. T27 beyond one round
3. T26 becomes a single button
4. T25 becomes a grid of cards
5. PDF support

**Never cut:** security matrix tests, T14, the T29 security specs.

**Rebalancing:** the lead's Wednesday is deliberately a buffer. If Frontend is behind, the lead takes T26. If AI is behind, the lead takes T24. Any teammate can approve PRs, so reviews never wait on one person.

### Backlog

Full acceptance criteria are in each GitHub issue.

<!-- BACKLOG:START -->

| ID  | Task                                                                         | Owner    | Planned               | MS  | Blocked by                   |
| --- | ---------------------------------------------------------------------------- | -------- | --------------------- | --- | ---------------------------- |
| T01 | Scaffold Next.js app & tooling ⚡                                            | Lead     | Thu 10/29 – Fri 10/30 | M1  | –                            |
| T02 | Database: Docker Postgres + Prisma 7 + Better Auth models + schema ⚡        | Lead     | Fri 10/30             | M1  | T01                          |
| T03 | API contract: openapi.yaml + Scalar docs + zod schemas + client types ⚡     | Lead     | Fri 10/30             | M1  | T01                          |
| T04 | Claude API wrapper + fake provider with failure modes ⚡                     | AI       | Fri 10/30             | M1  | T01                          |
| T05 | App shell, layout, auth page UIs & error boundaries                          | Frontend | Fri 10/30             | M1  | T01                          |
| T06 | Auth + secure API route wrapper (withApi) ⚡                                 | Lead     | Sat 10/31             | M1  | T02, T03                     |
| T07 | Test infrastructure: integration DB, auth helpers, contract validation ⚡    | Lead     | Sat 10/31             | M1  | T02, T03, T06                |
| T08 | Seed script                                                                  | AI       | Sat 10/31             | M1  | T02                          |
| T09 | Typed API client (openapi-fetch) + per-endpoint mocks ⚡                     | Frontend | Sat 10/31             | M1  | T03                          |
| T10 | Text extraction + upload validation ⚡ 🔒                                    | AI       | Sat 10/31             | M1  | T01                          |
| T11 | Chunker ⚡                                                                   | AI       | Sat 10/31             | M1  | T10                          |
| T12 | Documents API + processing pipeline ⚡                                       | AI       | Sun 11/1              | M2  | T02, T03, T04, T06, T07, T11 |
| T13 | Courses API ⚡                                                               | Lead     | Sun 11/1              | M2  | T03, T06, T07                |
| T14 | Security baseline: rate limiting, CSP/headers, safe logging, health check 🔒 | Lead     | Sun 11/1              | M2  | T06, T07, T12                |
| T15 | Notes library & upload UI                                                    | Frontend | Sat 10/31 – Sun 11/1  | M2  | T05, T06, T09                |
| T16 | Practice session UI (feedback mocked) ⚡                                     | Frontend | Sun 11/1 – Mon 11/2   | M2  | T05, T09                     |
| T17 | Question generation endpoint ⚡                                              | AI       | Mon 11/2              | M2  | T04, T06, T07, T08, T14      |
| T18 | Evidence verification (pure function) 🔒                                     | AI       | Mon 11/2              | M2  | T03                          |
| T19 | Mastery module (pure functions)                                              | Frontend | Mon 11/2              | M2  | T03                          |
| T20 | Vertical slice checkpoint (go/no-go) ⚡                                      | Lead     | Mon 11/2 (late)       | M2  | T13, T12, T15, T16, T17      |
| T21 | Map + next-concept endpoints                                                 | Lead     | Tue 11/3              | M3  | T13, T19                     |
| T22 | Answer evaluation endpoint ⚡ 🔒                                             | AI       | Tue 11/3 – Wed 11/4   | M3  | T14, T17, T18                |
| T23 | Feedback display UI ⚡                                                       | Frontend | Tue 11/3              | M3  | T16                          |
| T24 | Mastery updates on answer (transactional, concurrency-safe) ⚡               | AI       | Wed 11/4              | M3  | T19, T22                     |
| T25 | Concept map UI                                                               | Frontend | Wed 11/4 – Thu 11/5   | M3  | T05, T09                     |
| T26 | Practice weakest flow                                                        | Frontend | Thu 11/5              | M3  | T16                          |
| T27 | Eval set + prompt tuning (incl. prompt injection) 🔒                         | AI       | Thu 11/5 – Fri 11/6   | M4  | T22                          |
| T28 | Remove mocks + full integration ⚡                                           | Lead     | Thu 11/5 – Fri 11/6   | M3  | T21, T23, T24, T25, T26      |
| T29 | E2E tests: happy path + security (Playwright) ⚡ 🔒                          | AI       | Fri 11/6              | M4  | T28                          |
| T30 | UI polish + accessibility pass                                               | Frontend | Fri 11/6              | M4  | T15, T23, T25, T26           |
| T31 | Deploy to Vercel + Neon (stretch)                                            | Lead     | Fri 11/6 – Sat 11/7   | M4  | T28                          |
| T32 | Bug bash: smoke + abuse testing ⚡ 🔒                                        | Lead     | Sat 11/7              | M4  | T27, T29, T30                |
| T33 | README & submission prep ⚡                                                  | Lead     | Sat 11/7              | M4  | T28                          |
| T34 | Submit on Canvas ⚡                                                          | Lead     | Sun 11/8              | M4  | T32, T33                     |

⚡ critical path · 🔒 security-focused (every task still has security tests)

<!-- BACKLOG:END -->

---

## §12 Risks

| Risk                                | Mitigation                                                                                                                                                                                                                  |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lost first week                     | Scope cut, Claude Code implementing, contract-first + mocks, T20 go/no-go                                                                                                                                                   |
| Security holes under time pressure  | `withApi` secure-by-default, security matrix per route, hooks + CI + CodeQL + `/security-review`, abuse bash (T32)                                                                                                          |
| Ungrounded or gamed feedback        | `verifyEvidence`, prompt-injection rules + eval cases, LOW confidence doesn't move mastery                                                                                                                                  |
| Docker issues on Windows            | `npm run setup` checks and explains. Docker Desktop with WSL 2. Ports bound to 127.0.0.1:5433/5434 to avoid clashes with a local Postgres.                                                                                  |
| Teammates hit Claude Pro limits     | One task per session (`/clear`), lean CLAUDE.md, the lead (Max) picks up urgent work                                                                                                                                        |
| Lead is the bottleneck              | T19 → Frontend, T24 and T29 → AI, Wednesday buffer. Any teammate can approve a PR (CODEOWNERS still pulls the lead in for protected areas). T06 no longer waits on Frontend; start it Friday night if T02/T03 finish early. |
| Merge conflicts / blocked teammates | Folder ownership, protected contract/schema, small PRs, blocked-by links                                                                                                                                                    |
| API cost / Opus latency             | Fake provider by default, prompt caching, per-user rate limits, T27 measures Opus vs Sonnet for grading                                                                                                                     |
| Deploy rabbit hole                  | Stretch only, 2-hour cap                                                                                                                                                                                                    |
