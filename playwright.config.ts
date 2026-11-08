// E2E tests (T29, TESTING §4): Chromium against `next dev` on port 3100 with .env.test's values.
// Never reuses a running server and never reaches the dev database: the guard below runs as the
// config loads, before Playwright starts the server, and global setup checks again before it
// migrates or resets anything.
import { defineConfig, devices } from "playwright/test";
import { BASE_URL, PORT, e2eEnv, runDbStep } from "./tests/e2e/env";

// Refuses anything but the local `_test` database before the dev server even starts.
runDbStep("check");
const env = e2eEnv();

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "**/*.spec.ts",
  globalSetup: "./tests/e2e/global-setup.ts",
  // Every spec makes its own data, but one dev server compiling routes on demand is the bottleneck.
  workers: 1,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  // `next dev` compiles each route the first time it's hit; global setup warms them first.
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: BASE_URL,
    navigationTimeout: 60_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npx next dev -H 127.0.0.1 -p ${PORT}`,
    url: `${BASE_URL}/api/health`,
    env,
    reuseExistingServer: false,
    timeout: 180_000,
    // The dev server's own log ([WebServer] lines) shows what it compiled and why it asked pages
    // to reload. A test once failed in a Fast Refresh reload loop that couldn't be reproduced, so
    // keep this visible to catch the cause if it happens again.
    stdout: "pipe",
    stderr: "pipe",
  },
});
