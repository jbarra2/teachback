import path from "node:path";
import { configDefaults, defineConfig } from "vitest/config";

// Unit tests are two projects because one project can't mix environments:
// `unit` runs *.test.ts in Node, `unit-dom` runs *.test.tsx in jsdom. `npm run test` runs both.
// `integration` runs *.int.test.ts against the real test database (db-test), one file at a time:
// its setup loads .env.test, refuses anything but a local `_test` database, migrates once, and
// empties every table before each file (tests/integration/, tests/helpers/test-db.ts).
const exclude = [...configDefaults.exclude, "**/*.int.test.ts", "tests/e2e/**"];

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
  test: {
    projects: [
      {
        test: {
          name: "unit",
          environment: "node",
          include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
          exclude,
        },
      },
      {
        test: {
          name: "unit-dom",
          environment: "jsdom",
          include: ["src/**/*.test.tsx", "tests/**/*.test.tsx"],
          exclude,
          setupFiles: ["./vitest.setup.ts"],
        },
      },
      {
        test: {
          name: "integration",
          environment: "node",
          include: ["src/**/*.int.test.ts", "tests/**/*.int.test.ts"],
          exclude: [...configDefaults.exclude, "tests/e2e/**"],
          globalSetup: ["./tests/integration/global-setup.ts"],
          setupFiles: ["./tests/integration/setup.ts"],
          // One database, so one file at a time.
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
    // Server code only, with docs/TESTING.md §4's thresholds (`npm run test:ci` fails below them).
    // src/lib/api is held at 100%: withApi and the auth route guard every request.
    coverage: {
      provider: "v8",
      include: ["src/lib/{api,ai,ingest,mastery,services}/**/*.ts"],
      exclude: ["**/*.test.ts", "**/*.int.test.ts"],
      reporter: ["text", "html", "json-summary"],
      thresholds: {
        lines: 80,
        branches: 75,
        "src/lib/api/**": {
          lines: 100,
          branches: 100,
          functions: 100,
          statements: 100,
        },
        "src/lib/ingest/**": { lines: 90, branches: 85 },
        "src/lib/mastery/**": { lines: 95, branches: 90 },
        "src/lib/ai/verify-evidence.ts": { lines: 95, branches: 90 },
      },
    },
  },
});
