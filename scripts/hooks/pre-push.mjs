// pre-push: block direct pushes to main, then run the fast checks (`npm run check`).
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const input = (() => {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return null; // couldn't read what's being pushed
  }
})();
const pushesMain =
  input === null ||
  input.split("\n").some((line) => line.split(" ")[2] === "refs/heads/main");
if (pushesMain && process.env.ALLOW_MAIN_PUSH !== "1") {
  console.error(
    "\n✖ Don't push to main directly. Push your branch and open a PR (/finish-task).\n",
  );
  process.exit(1);
}

if (!existsSync("package.json")) process.exit(0);
const { scripts = {} } = JSON.parse(readFileSync("package.json", "utf8"));
if (!scripts.check) process.exit(0);

console.log("pre-push: npm run check (format, lint, typecheck, unit tests)...");
const isWin = process.platform === "win32";
const res = isWin
  ? spawnSync("npm run check", { stdio: "inherit", shell: true })
  : spawnSync("npm", ["run", "check"], { stdio: "inherit" });
if (res.status !== 0) {
  console.error(
    "\n✖ Push blocked: `npm run check` failed. Fix it (Claude can help), then push again.\n",
  );
  process.exit(1);
}
