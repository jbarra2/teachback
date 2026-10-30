---
name: setup
description: Set up (or repair) this project on my machine. Checks prerequisites, creates .env, installs packages, starts the Docker databases, runs migrations and seed, and verifies.
disable-model-invocation: true
allowed-tools: Bash(node scripts/setup.mjs:*), Bash(npm run setup:*), Bash(node --version), Bash(git --version), Bash(docker --version), Bash(docker info:*), Bash(docker compose ps:*), Bash(docker compose version), Bash(docker compose up:*), Bash(docker compose logs:*), Bash(gh --version), Bash(gh auth status:*), Bash(git status:*), Bash(git config --get:*)
---

Set up this machine for the project. Be patient and friendly; the person may be new to some of these tools.

1. **Run the setup script:** `npm run setup` if `package.json` exists, otherwise `node scripts/setup.mjs`. It's idempotent.
2. **If it stops with ✖**, read the "How to fix" line and help:
   - **Missing tool:** give the exact install command for their OS (Windows → `winget ...`, macOS → `brew ...` or the download link). Ask them to install it, then **close every VS Code window and reopen it** (on Windows the new PATH isn't picked up otherwise) and run `/setup` again.
   - **Docker not running:** ask them to start Docker Desktop and wait for "Engine running". On Windows, if Docker Desktop complains about WSL, have them run `wsl --install` in an admin PowerShell and reboot.
   - **Ports 5433/5434 in use:** run `docker compose ps` to check whether these containers are already up. If another program is using the port, explain and ask whether to stop it. Never change the ports yourself; tell them to ask the lead.
   - **npm install / migration errors:** read the error, explain it in one line, and fix it if it's environmental (e.g. Node version). If it looks like a repo problem, tell them to post it in the team chat.
3. **Notes marked "!"** (e.g. `gh` not signed in): walk them through each one (`gh auth login` → GitHub.com → HTTPS → browser).
4. **Never** print or read `.env` contents, change the ports or `docker-compose.yml`, delete Docker volumes, or run destructive DB commands.
5. **Finish** with a short checklist of what's ready, then:
   - "Run `npm run dev` and open http://localhost:3000 (demo accounts are in the README)."
   - "When you're ready: `/next-task`."
