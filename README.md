# TeachBack

Notes that teach you back: upload lecture notes, explain concepts in your own words, get feedback grounded in your notes, and see what to review next.

> In development. Submission: Nov 8, 2026. The final README is task T33.

**Quick start:** install Node 24 or 26 (with the npm 11 it comes with), Git, the GitHub CLI and Docker Desktop. Then:

```bash
npm run setup      # or, in Claude Code: /setup
npm run dev        # http://localhost:3000, API docs at /api/docs
```

The dev server only listens on your own machine. To try it on a phone on the same Wi-Fi, run `npm run dev -- -H 0.0.0.0` for that session and open `http://<your-computer's-IP>:3000`. Anyone on that network can then reach your dev server, so only do this on a network you trust (not campus or café Wi-Fi), and stop the server when you're done.

- Team workflow: [CONTRIBUTING.md](CONTRIBUTING.md)
- Spec and schedule: [docs/PLAN.md](docs/PLAN.md)
- Testing and security: [docs/TESTING.md](docs/TESTING.md)
- API contract: [openapi/openapi.yaml](openapi/openapi.yaml)

## Demo accounts

`npm run setup` loads demo data with `npm run db:seed`. You can run it again at any time: it never resets the demo accounts' progress or changes a password. These accounts exist only in your local database, and the seed refuses to run in production.

| Account        | Email                   | Password          | Has                                                                        |
| -------------- | ----------------------- | ----------------- | -------------------------------------------------------------------------- |
| Demo student A | `demo-a@teachback.test` | `demo-password-a` | A course with sorting-algorithm notes, 5 concepts and 2 practice questions |
| Demo student B | `demo-b@teachback.test` | `demo-password-b` | A small course of their own, for cross-user checks                         |

If you already signed up with one of these emails using a different password, the seed leaves that account alone and says so. Delete it yourself if you want the demo account back.
