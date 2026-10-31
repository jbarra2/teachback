// ESLint flat config. Rules come from docs/TESTING.md §5.
// Layers: base (every file) → typed (TS in src/**, tests/**) → layering (src/**, tests/**) → per-folder overrides.
// Inline `eslint-disable` comments are switched off: an approved exception goes here, in review.
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Typed rules need TypeScript; the layering rules cover JavaScript files too (Next serves .js routes).
const TS = "{ts,tsx,mts,cts}";
const CODE = "{js,jsx,mjs,cjs,ts,tsx,mts,cts}";
const TYPED_FILES = [`src/**/*.${TS}`, `tests/**/*.${TS}`];
const LAYERED_FILES = [`src/**/*.${CODE}`, `tests/**/*.${CODE}`];
const NO_DB_FILES = [`src/app/**/*.${CODE}`, `src/components/**/*.${CODE}`];
const CONFIG_FILES = ["*.config.{js,mjs,cjs,ts,mts}", "vitest.setup.ts"];

const AI_MESSAGE = "Call Claude only through src/lib/ai/provider.ts.";
const DB_MESSAGE =
  "No database access in pages, route handlers or components. Call a service in src/lib/services/.";

// Import sources, as regexes so relative paths (../../lib/db) are caught too.
const AI_SOURCES = [{ regex: "^@anthropic-ai/sdk(/|$)", message: AI_MESSAGE }];
const DB_SOURCES = [
  { regex: "(^|/)lib/db(\\.ts|/.*)?$", message: DB_MESSAGE },
  { regex: "(^|/)generated/prisma(/|$)", message: DB_MESSAGE },
  { regex: "^@prisma/", message: DB_MESSAGE },
  { regex: "^(pg|postgres)(/|$)", message: DB_MESSAGE },
];

// no-restricted-imports doesn't see `await import("...")`, so dynamic imports are banned by syntax.
// Selector regexes can't contain "/", so it's written as \x2F. A path that isn't a plain string
// (a template literal or a variable) can't be checked, so it's banned wherever layering applies.
const dynamicImportBans = (sources) =>
  sources.length === 0
    ? []
    : [
        ...sources.map(({ regex, message }) => ({
          selector: `ImportExpression[source.value=/${regex.replaceAll("/", "\\x2F")}/]`,
          message,
        })),
        {
          selector: 'ImportExpression[source.type!="Literal"]',
          message:
            "Dynamic import paths must be plain strings, so the layering rules can check them.",
        },
      ];

// $queryRawUnsafe / $executeRawUnsafe in any form: db.$queryRawUnsafe, db["$queryRawUnsafe"], destructuring.
const RAW_UNSAFE = "/^\\$(queryRawUnsafe|executeRawUnsafe)$/";
const RAW_MESSAGE =
  "Raw SQL built from strings is banned. Use the tagged template db.$queryRaw`...`, which parameterizes values.";
const RAW_UNSAFE_BANS = [
  { selector: `Identifier[name=${RAW_UNSAFE}]`, message: RAW_MESSAGE },
  { selector: `Literal[value=${RAW_UNSAFE}]`, message: RAW_MESSAGE },
  {
    selector: `TemplateElement[value.raw=${RAW_UNSAFE}]`,
    message: RAW_MESSAGE,
  },
];

const restrictImports = (sources) => [
  "error",
  { patterns: sources.map(({ regex, message }) => ({ regex, message })) },
];
const restrictSyntax = (sources) => [
  "error",
  ...RAW_UNSAFE_BANS,
  ...dynamicImportBans(sources),
];

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
    "src/generated/**",
    "src/lib/api-client/schema.d.ts",
  ]),

  // Base: every linted file.
  {
    linterOptions: { noInlineConfig: true },
    rules: {
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",
      "no-console": "error",
      "@typescript-eslint/no-explicit-any": "error",
      "no-restricted-syntax": ["error", ...RAW_UNSAFE_BANS],
    },
  },

  // Raw HTML. Only where eslint-config-next registers the React plugin (not .cjs, which can't hold JSX).
  {
    files: ["**/*.{js,jsx,mjs,ts,tsx,mts,cts}"],
    rules: { "react/no-danger": "error" },
  },

  // App and test code (TypeScript): typed linting.
  {
    files: TYPED_FILES,
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      // The type-aware version replaces the core rule here.
      "no-implied-eval": "off",
      "@typescript-eslint/no-implied-eval": "error",
    },
  },

  // App and test code (any language): the layering rules.
  {
    files: LAYERED_FILES,
    rules: {
      "no-restricted-imports": restrictImports(AI_SOURCES),
      "no-restricted-syntax": restrictSyntax(AI_SOURCES),
    },
  },

  // Pages, route handlers and components never touch the database directly.
  {
    files: NO_DB_FILES,
    rules: {
      "no-restricted-imports": restrictImports([...AI_SOURCES, ...DB_SOURCES]),
      "no-restricted-syntax": restrictSyntax([...AI_SOURCES, ...DB_SOURCES]),
    },
  },

  // The one place allowed to use the Anthropic SDK.
  {
    files: [`src/lib/ai/**/*.${CODE}`],
    rules: {
      "no-restricted-imports": "off",
      "no-restricted-syntax": restrictSyntax([]),
    },
  },

  // The logger is the one place in app code that writes to the console.
  {
    files: ["src/lib/log.ts"],
    rules: { "no-console": "off" },
  },

  // Scripts and config files: untyped base config, console allowed.
  {
    files: ["scripts/**", ...CONFIG_FILES],
    rules: { "no-console": "off" },
  },
]);
