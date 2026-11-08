/**
 * The AI grading eval (T27): grades every case in fixtures/eval/cases.json with the real provider,
 * once per model, saves the scores to fixtures/eval/results/<round>/<model>.json, and rebuilds
 * docs/eval.md from every saved run.
 *
 *   npm run eval -- --round baseline --note "Prompt as shipped in T22."
 *   npm run eval -- --round tuned-1 --models claude-opus-5-5 --note "..."
 *   npm run eval -- --round smoke --only sort-good-merge --no-save
 *   npm run eval -- --report-only
 *
 * Real API calls cost money: about one grading call per case per model. Never prints the key,
 * the answers or the model's text, only ids, verdicts and timings.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { format, resolveConfig } from "prettier";
import {
  type CaseResult,
  type RunRecord,
  assertRoundName,
  parseEvalFile,
  parseRunRecord,
  renderReport,
  resultFile,
  runModels,
  summarize,
} from "../src/lib/ai/eval";
import { evaluateAnswer } from "../src/lib/ai/evaluate-answer";

const ROOT = path.resolve(__dirname, "..");
const RESULTS = path.join(ROOT, "fixtures/eval/results");
const REPORT = path.join(ROOT, "docs/eval.md");
const DEFAULT_MODELS = "claude-opus-5-5,claude-sonnet-5-5";

function savedRuns(): RunRecord[] {
  let rounds: string[];
  try {
    rounds = readdirSync(RESULTS);
  } catch {
    return [];
  }
  return rounds.flatMap((round) =>
    readdirSync(path.join(RESULTS, round))
      .filter((name) => name.endsWith(".json"))
      .map((name) =>
        parseRunRecord(
          JSON.parse(readFileSync(path.join(RESULTS, round, name), "utf8")),
        ),
      ),
  );
}

/** Formatted with the repo's own Prettier config, so the generated file passes `npm run verify`. */
async function writeReport(): Promise<void> {
  const options = (await resolveConfig(REPORT)) ?? {};
  const markdown = await format(renderReport(savedRuns()), {
    ...options,
    parser: "markdown",
  });
  writeFileSync(REPORT, markdown);
  console.log(`Wrote ${path.relative(ROOT, REPORT)}.`);
}

function line(result: CaseResult): string {
  const mark = result.agrees ? "✓" : "✗";
  const got = result.error
    ? `error ${result.error}`
    : `${result.verdict} (${result.confidence})`;
  const dropped =
    result.dropped > 0 ? `, ${result.dropped} quote(s) dropped` : "";
  return `  ${mark} ${result.id}: expected ${result.expected}, got ${got}${dropped}, ${(result.ms / 1000).toFixed(1)} s`;
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      round: { type: "string" },
      models: { type: "string", default: DEFAULT_MODELS },
      note: { type: "string", default: "" },
      only: { type: "string" },
      "no-save": { type: "boolean", default: false },
      "report-only": { type: "boolean", default: false },
    },
  });

  if (values["report-only"]) {
    await writeReport();
    return 0;
  }
  if (!values.round) {
    console.error("Pass --round <name> (for example --round baseline).");
    return 1;
  }
  try {
    assertRoundName(values.round);
  } catch (error) {
    console.error((error as Error).message);
    return 1;
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error(
      "ANTHROPIC_API_KEY is not set. Add your key to .env (see .env.example), then run this again.",
    );
    return 1;
  }
  process.env.AI_PROVIDER = "anthropic";

  const file = parseEvalFile(
    JSON.parse(
      readFileSync(path.join(ROOT, "fixtures/eval/cases.json"), "utf8"),
    ),
  );
  const only = values.only?.split(",").map((id) => id.trim());
  const cases = only
    ? file.cases.filter((c) => only.includes(c.id))
    : file.cases;
  if (cases.length === 0) {
    console.error("No cases match --only.");
    return 1;
  }
  const notes = new Map(
    Object.entries(file.noteSets).map(([key, set]) => [
      key,
      {
        title: set.title,
        text: readFileSync(path.join(ROOT, set.file), "utf8"),
      },
    ]),
  );

  const models = values.models.split(",").map((model) => model.trim());
  const runs = await runModels({
    models,
    round: values.round,
    note: values.note,
    cases,
    notes,
    grade: evaluateAnswer,
    setModel: (model) => {
      process.env.AI_MODEL_SMART = model;
    },
    onModel: (model) =>
      console.log(`\n${model} (${cases.length} case(s), one at a time):`),
    onResult: (result) => console.log(line(result)),
  });
  for (const run of runs) {
    const s = summarize(run.results);
    console.log(
      `${run.model}: agreement ${s.graded.agree}/${s.graded.total}, injection ${s.injection.resisted}/${s.injection.total}, dropped ${s.dropped}, errors ${s.errors}, median ${(s.medianMs / 1000).toFixed(1)} s`,
    );
    if (!values["no-save"]) {
      // runModels returns runs already checked by the strict schema: no model text gets saved.
      const file = path.join(RESULTS, resultFile(run.round, run.model));
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, `${JSON.stringify(run, null, 2)}\n`);
    }
  }
  if (!values["no-save"]) await writeReport();
  return 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    // Our own message only for our own errors; anything else could echo request details.
    console.error(
      error instanceof Error && error.name === "ZodError"
        ? "✖ A case or saved run doesn't match the expected shape."
        : "✖ The eval stopped on an unexpected error.",
    );
    process.exitCode = 1;
  },
);
