#!/usr/bin/env node
/**
 * Generates the client types from the API contract (PLAN §7) with openapi-typescript.
 *
 *   npm run api:types         writes src/lib/api-client/schema.d.ts
 *   npm run api:types:check   fails if that file is missing or doesn't match openapi.yaml
 *
 * The check regenerates in memory and compares with the file on disk, so it doesn't depend on
 * git: an untracked file can't pass it, and an up-to-date file that isn't staged yet doesn't fail.
 * `--spec <file>` and `--out <file>` override the paths (tests/tooling/api-scripts.test.ts).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import openapiTS, { astToString } from "openapi-typescript";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HEADER = `/**
 * Generated from openapi/openapi.yaml by \`npm run api:types\`. Do not edit by hand:
 * change the spec, then regenerate. \`npm run api:types:check\` (CI) fails if this file is stale.
 */

`;
// Upload fields (a string with a `contentMediaType`) are a Blob or File in the browser, not a string.
const BLOB = ts.factory.createTypeReferenceNode(
  ts.factory.createIdentifier("Blob"),
);

/** The generated file's text for `specPath`. */
async function generateTypes(specPath) {
  const ast = await openapiTS(pathToFileURL(specPath), {
    transform(schema) {
      if (schema.type === "string" && schema.contentMediaType) return BLOB;
      return undefined;
    },
  });
  return HEADER + astToString(ast);
}

const option = (name, fallback) => {
  const at = process.argv.indexOf(name);
  return at === -1 ? fallback : path.resolve(process.argv[at + 1]);
};

// A command only, so no `import.meta.main` guard: it's undefined before Node 24.2, where the
// script would quietly do nothing and the check would pass.
const specPath = option("--spec", path.join(root, "openapi", "openapi.yaml"));
const outPath = option(
  "--out",
  path.join(root, "src", "lib", "api-client", "schema.d.ts"),
);
const generated = await generateTypes(specPath);
const shown = path.relative(root, outPath) || outPath;
if (!process.argv.includes("--check")) {
  writeFileSync(outPath, generated);
  console.log(`Wrote ${shown}.`);
} else if (!existsSync(outPath)) {
  console.error(`✖ ${shown} is missing. Run \`npm run api:types\`.`);
  process.exit(1);
} else if (readFileSync(outPath, "utf8").replace(/\r\n/g, "\n") !== generated) {
  console.error(
    `✖ ${shown} doesn't match openapi.yaml. Run \`npm run api:types\` and commit the result.`,
  );
  process.exit(1);
} else {
  console.log(`${shown} matches openapi.yaml.`);
}
