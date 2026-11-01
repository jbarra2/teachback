/**
 * One tiny real Claude call, to check that ANTHROPIC_API_KEY in .env works.
 *
 *   npm run ai:ping
 *
 * Uses the real provider whatever AI_PROVIDER says. Never prints the key.
 */
import { z } from "zod";
import { AiError } from "../src/lib/ai/errors";
import { generateJson, resolveModel } from "../src/lib/ai/provider";

async function main(): Promise<number> {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error(
      "ANTHROPIC_API_KEY is not set. Add your key to .env (see .env.example), then run this again.",
    );
    return 1;
  }
  process.env.AI_PROVIDER = "anthropic";
  const model = resolveModel("fast");

  try {
    const result = await generateJson(
      z.object({ ok: z.boolean() }),
      { system: "Reply with JSON only.", user: 'Return {"ok": true}.' },
      // `task` only picks the fake provider's fixture; the real provider ignores it.
      { model: "fast", task: "generateQuestion" },
    );
    console.log(`✔ AI ping OK (${model}): ${JSON.stringify(result)}`);
    return 0;
  } catch (error) {
    // Print only our own error code and message: upstream errors could echo request details.
    if (error instanceof AiError) {
      const status = error.upstreamStatus
        ? `, HTTP ${error.upstreamStatus}`
        : "";
      console.error(
        `✖ AI ping failed (${model}): ${error.code}${status}. ${error.message}`,
      );
      if (error.upstreamStatus === 401)
        console.error("  Check ANTHROPIC_API_KEY in .env.");
    } else {
      console.error("✖ AI ping failed with an unexpected error.");
    }
    return 1;
  }
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  () => {
    process.exitCode = 1;
  },
);
