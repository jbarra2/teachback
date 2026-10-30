# Deploying (stretch goal, T31)

Free stack: **Vercel Hobby** (app) + **Neon Free** (production Postgres only; development uses local Docker). Not required for submission. If it takes more than about 2 hours, stop.

## Limits that matter

- Vercel Hobby is free for personal, non-commercial projects. The repo must be on a personal GitHub account; org-owned private repos need Vercel Pro.
- Vercel rejects request bodies over 4.5 MB, hence `MAX_UPLOAD_MB=4`.
- Functions run up to 300 s on Hobby, so `after()` processing for an upload must finish within that.
- Neon Free: 0.5 GB storage and 100 compute-hours per project per month. The database sleeps when idle, so the first request is slow.

## Steps

1. **Neon:** sign up (free, no card) and create project `teachback`. Copy the **pooled** and **direct** connection strings for the `main` branch.
2. **Vercel:** sign up with GitHub (Hobby), then Add New → Project → import the repo. Framework: Next.js.
3. **Build command:** add `"build:deploy": "prisma migrate deploy && next build"` to package.json, then set Settings → Build → Build Command to `npm run build:deploy`.
4. **Environment variables** (Production):

   | Name                                                                              | Value                                                                                            |
   | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
   | `DATABASE_URL`                                                                    | Neon **pooled** string                                                                           |
   | `DIRECT_URL`                                                                      | Neon **direct** string                                                                           |
   | `BETTER_AUTH_SECRET`                                                              | a new random secret (never reuse a dev one)                                                      |
   | `BETTER_AUTH_URL`                                                                 | `https://<project>.vercel.app`                                                                   |
   | `AI_PROVIDER`                                                                     | `anthropic`                                                                                      |
   | `ANTHROPIC_API_KEY`                                                               | a separate key just for production (if your Claude Console account offers spend limits, set one) |
   | `AI_MODEL_FAST` / `AI_MODEL_SMART`                                                | same as `.env.example`                                                                           |
   | `MAX_UPLOAD_MB` / `MAX_NOTE_CHARS`                                                | `4` / `200000`                                                                                   |
   | `RATE_LIMIT_AI_PER_MIN` / `RATE_LIMIT_AI_PER_DAY` / `RATE_LIMIT_UPLOADS_PER_HOUR` | `10` / `100` / `5` (stricter than dev)                                                           |
   | `RATE_LIMIT_AI_GLOBAL_PER_DAY`                                                    | `500` (caps total AI calls across all accounts)                                                  |
   | `API_DOCS_ENABLED`                                                                | `false` (turn on only for demos)                                                                 |

5. **Previews:** disable preview deployments for this project (Settings → Git), so preview builds never touch the production DB.
6. **Deploy**, then on the live URL:
   - run the smoke test (docs/TESTING.md §7)
   - check the security headers (devtools → Network → document response): CSP, HSTS, `X-Content-Type-Options`
7. Add the live URL to the README.

## If something breaks

- **413 on upload:** the file is over 4 MB.
- **504, or a document stuck processing:** extraction took too long. Use smaller batches.
- **Login redirect loop:** `BETTER_AUTH_URL` must exactly match the production URL.
- **Prisma can't connect:** pooled string in `DATABASE_URL`, direct string in `DIRECT_URL`.
- **CSP blocks something:** check the browser console. Adjust `src/proxy.ts` (lead) and add a test.
