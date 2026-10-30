// Points git at .githooks/ so the team's hooks run. Called by `npm install` ("prepare") and by setup.
// Also normalizes hook line endings (Windows editors can save CRLF, which breaks #!/bin/sh).
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";

try {
  if (existsSync(".git") && existsSync(".githooks")) {
    for (const name of readdirSync(".githooks")) {
      const file = `.githooks/${name}`;
      const text = readFileSync(file, "utf8");
      if (text.includes("\r\n"))
        writeFileSync(file, text.replace(/\r\n/g, "\n"));
      if (process.platform !== "win32") chmodSync(file, 0o755);
    }
    execFileSync("git", ["config", "core.hooksPath", ".githooks"], {
      stdio: "ignore",
    });
  }
} catch {
  // Never fail an install because of hooks.
}
