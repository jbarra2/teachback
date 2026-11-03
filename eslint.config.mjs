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
// Prisma's SQL helpers (@prisma/client-runtime-utils):
// - Prisma.raw and Prisma.Sql paste strings into SQL unescaped.
// - Prisma.sql is typed `sql(strings: readonly string[], ...values)`, so it's only safe as a tag:
//   called as a function, every string in its array is SQL text.
// - Prisma.join pastes its separator, prefix and suffix unescaped, so it takes the values only.
// These bans look for the name `Prisma`, so Prisma can't be renamed, copied, destructured or reached
// through `* as` or a computed key, and the helpers can't be imported on their own.
const PRISMA_RAW_MESSAGE =
  "Prisma.raw() puts a string into SQL unescaped. Use Prisma.sql`...` or the tagged db.$queryRaw`...`, which parameterize values.";
const PRISMA_SQL_MESSAGE =
  "Use Prisma.sql only as a tagged template (Prisma.sql`...`). Called as a function, it puts every string into SQL unescaped.";
const PRISMA_JOIN_MESSAGE =
  "Call Prisma.join in place with the values only: Prisma.join(ids). Its separator, prefix and suffix go into SQL unescaped.";
const PRISMA_NAME_MESSAGE =
  "Use Prisma under its own name, with plain member names (Prisma.sql`...`, Prisma.join(ids)): no copies, renames, destructuring or computed keys, so the raw-SQL bans can see it.";
const PRISMA_HELPERS = "/^(raw|sql|sqltag|join|Sql)$/";
// $queryRaw and $executeRaw only as a tag, or called with a Prisma.sql`...` written in place. A query
// held in a variable, an array or anything else can carry raw SQL text.
const RAW_TAGGED = "/^\\$(queryRaw|executeRaw)$/";
const RAW_TAGGED_MESSAGE =
  "Call $queryRaw and $executeRaw as tagged templates (db.$queryRaw`...`), or pass a Prisma.sql`...` written in place. A query from anywhere else can hold raw SQL text.";
const RAW_UNSAFE_BANS = [
  { selector: `Identifier[name=${RAW_UNSAFE}]`, message: RAW_MESSAGE },
  { selector: `Literal[value=${RAW_UNSAFE}]`, message: RAW_MESSAGE },
  {
    selector: `TemplateElement[value.raw=${RAW_UNSAFE}]`,
    message: RAW_MESSAGE,
  },
  {
    selector:
      'MemberExpression[object.name="Prisma"][property.name=/^(raw|Sql)$/]',
    message: PRISMA_RAW_MESSAGE,
  },
  {
    selector:
      'MemberExpression[object.name="Prisma"][property.name="sql"]:not(TaggedTemplateExpression > .tag)',
    message: PRISMA_SQL_MESSAGE,
  },
  {
    selector:
      'CallExpression[callee.object.name="Prisma"][callee.property.name="join"][arguments.length>1]',
    message: PRISMA_JOIN_MESSAGE,
  },
  {
    selector:
      'MemberExpression[object.name="Prisma"][property.name="join"]:not(CallExpression > .callee)',
    message: PRISMA_JOIN_MESSAGE,
  },
  {
    selector: 'MemberExpression[object.name="Prisma"][computed=true]',
    message: PRISMA_NAME_MESSAGE,
  },
  // Copies and destructuring: `const P = Prisma`, `const { sql } = Prisma`, `({ join: j } = Prisma)`.
  {
    selector: 'VariableDeclarator[init.name="Prisma"]',
    message: PRISMA_NAME_MESSAGE,
  },
  {
    selector: 'AssignmentExpression[right.name="Prisma"]',
    message: PRISMA_NAME_MESSAGE,
  },
  // Renames: on import, on re-export, and when destructuring a module (`const { Prisma: P } = mod`).
  {
    selector: 'ImportSpecifier[imported.name="Prisma"][local.name!="Prisma"]',
    message: PRISMA_NAME_MESSAGE,
  },
  {
    selector:
      'ExportNamedDeclaration[source.value=/prisma/] > ExportSpecifier[local.name="Prisma"][exported.name!="Prisma"]',
    message: PRISMA_NAME_MESSAGE,
  },
  {
    selector:
      'ObjectPattern > Property[key.name="Prisma"][value.name!="Prisma"]',
    message: PRISMA_NAME_MESSAGE,
  },
  // Whole modules, and the helpers on their own.
  {
    selector:
      "ImportDeclaration[source.value=/prisma/] > ImportNamespaceSpecifier",
    message: PRISMA_NAME_MESSAGE,
  },
  {
    selector: "ExportAllDeclaration[source.value=/prisma/]",
    message: PRISMA_NAME_MESSAGE,
  },
  {
    selector: `ImportDeclaration[source.value=/prisma/] > ImportSpecifier[imported.name=${PRISMA_HELPERS}]`,
    message: PRISMA_NAME_MESSAGE,
  },
  {
    selector: `ExportNamedDeclaration[source.value=/prisma/] > ExportSpecifier[local.name=${PRISMA_HELPERS}]`,
    message: PRISMA_NAME_MESSAGE,
  },
  // $queryRaw/$executeRaw by name or string key, unless it's the tag, or it's called with a
  // Prisma.sql`...` as its first argument. Catches arrays, variables, .call/.apply and copies.
  {
    selector: `MemberExpression:matches([property.name=${RAW_TAGGED}], [property.value=${RAW_TAGGED}]):not(TaggedTemplateExpression > .tag):not(CallExpression[arguments.0.type="TaggedTemplateExpression"][arguments.0.tag.object.name="Prisma"][arguments.0.tag.property.name="sql"] > .callee)`,
    message: RAW_TAGGED_MESSAGE,
  },
  {
    selector: `ObjectPattern > Property:matches([key.name=${RAW_TAGGED}], [key.value=${RAW_TAGGED}])`,
    message: RAW_TAGGED_MESSAGE,
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
