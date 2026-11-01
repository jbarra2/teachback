#!/usr/bin/env node
/**
 * Lints the API contract with Redocly CLI (rules in redocly.yaml).
 *
 *   npm run api:lint                       openapi/openapi.yaml
 *   node scripts/api-lint.mjs <spec.yaml>  another file (tests/tooling/api-scripts.test.ts)
 *
 * A wrapper rather than a bare `redocly lint`, for two settings an npm script can't set inline on
 * Windows: no update check (every 12 hours it asks the npm registry for the latest version, and on
 * Windows that request makes the process abort with exit code 127 after a passing lint), and no
 * usage data sent to Redocly (also off in redocly.yaml).
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const spec = process.argv[2] ?? path.join("openapi", "openapi.yaml");
const cli = path.join(root, "node_modules", "@redocly", "cli", "bin", "cli.js");

const result = spawnSync(process.execPath, [cli, "lint", spec], {
  cwd: root,
  stdio: "inherit",
  env: {
    ...process.env,
    REDOCLY_SUPPRESS_UPDATE_NOTICE: "true",
    REDOCLY_TELEMETRY: "off",
  },
});
if (result.error) console.error(result.error.message);
// Only a clean exit passes: a spawn failure or a kill (status null) fails, like a lint error.
process.exit(result.status === 0 ? 0 : 1);
