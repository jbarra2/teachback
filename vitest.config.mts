import path from "node:path";
import { configDefaults, defineConfig } from "vitest/config";

// Unit tests are two projects because one project can't mix environments:
// `unit` runs *.test.ts in Node, `unit-dom` runs *.test.tsx in jsdom. `npm run test` runs both.
// *.int.test.ts is left for the `integration` project (T07).
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
    ],
    // Server code only (docs/TESTING.md §4). Thresholds arrive with the integration project in T07.
    coverage: {
      provider: "v8",
      include: ["src/lib/{api,ai,ingest,mastery,services}/**/*.ts"],
      exclude: ["**/*.test.ts", "**/*.int.test.ts"],
      reporter: ["text", "html", "json-summary"],
    },
  },
});
