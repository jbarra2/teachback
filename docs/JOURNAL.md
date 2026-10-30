# Work journals (`docs/journal/`)

Each of us keeps a record of what we built and learned, one entry per task. Use it to study after the project, to write the README's Team section (T33), and as material for your resume and interviews.

- **Your file:** `docs/journal/<your-github-username>.md`. Only edit your own.
- **When:** `/finish-task` adds the entry before it commits, so the entry ships in the same PR as the work.
- **Public repo:** never put keys, `.env` values, passwords or personal details in a journal.

## The three ways to write an entry

`/finish-task` fills in the facts (task, date, what you built, skills used) from the issue and your diff. Then it asks how you want to answer the two questions:

| Option                       | What happens                                                                                                                               | Use it when            |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------- |
| **1. I'll write my answers** | Claude asks the two questions and saves your words as you wrote them.                                                                      | You have a few minutes |
| **2. Draft it, I'll edit**   | Claude drafts both answers from this task's conversation (what went wrong, how it was fixed, the decisions you made). You edit or approve. | Most of the time       |
| **3. Write it for me**       | Claude writes the whole entry and marks it `<!-- needs-review -->`, so you can find it and read it later.                                  | You're out of time     |

The drafts are only as good as the session they come from. If you ran `/clear` mid-task, Claude only has the diff and commits, so it writes less. It never makes up problems or lessons that didn't happen.

**Clearing the marker:** read the entry, fix anything that's off, and delete the `<!-- needs-review -->` line. To find them: `git grep -n needs-review docs/journal`. Clear yours before Saturday Nov 7 (T33).

## Format

New file (Claude creates it the first time):

```md
# Work journal: Your Name (@your-github-username)

**Role:** Frontend on TeachBack, a Next.js app that grades students' explanations against their own notes.

One entry per task, oldest first.
```

Each entry:

```md
## T05 · App shell (#5) · Oct 30, 2026

**What I built:** One or two concrete sentences: the feature, the main files, how it fits the app.

**Skills & tools:** Next.js App Router, React Server Components, Tailwind CSS, Vitest

**Hardest part, and how I solved it:**
2–4 sentences. The specific problem (an error, a bug, a design choice) and what fixed it.

**What I learned:**
2–4 sentences. Something you can explain to someone else, and when you'd use it again.
```

## After the project

Ask Claude: _"Read `docs/journal/<me>.md` and write 4 resume bullets and a 3-sentence project summary for my portfolio."_ Only keep what you can explain in an interview.
