// The one error type that leaves src/lib/ai. Routes map it to 502 AI_UNAVAILABLE (PLAN §8).
// Messages are fixed per code and the upstream error is never attached, so request details
// (headers, the API key, prompt text) can't leak through it.

export const AI_ERROR_CODES = [
  "TIMEOUT",
  "RATE_LIMITED",
  "UPSTREAM",
  "INVALID_OUTPUT",
] as const;
export type AiErrorCode = (typeof AI_ERROR_CODES)[number];

const MESSAGES: Record<AiErrorCode, string> = {
  TIMEOUT: "The AI service took too long to respond.",
  RATE_LIMITED: "The AI service is busy. Please try again shortly.",
  UPSTREAM: "The AI service is unavailable right now.",
  INVALID_OUTPUT: "The AI service returned an unusable response.",
};

export class AiError extends Error {
  readonly code: AiErrorCode;
  /** HTTP status from the AI service, when there was one. */
  readonly upstreamStatus?: number;

  constructor(code: AiErrorCode, upstreamStatus?: number) {
    super(MESSAGES[code]);
    this.name = "AiError";
    this.code = code;
    this.upstreamStatus = upstreamStatus;
  }
}
