// The one place app code writes logs (CLAUDE.md, TESTING §8). One JSON line per entry. Fields
// take plain values only, so an error object, a request body or a connection string can't end up
// in a log by accident: log an error's `name`, never the error. T14 extends this.

type Level = "debug" | "info" | "warn" | "error";
type Value = string | number | boolean | null | undefined;
export type LogFields = Record<string, Value>;

const RESERVED = new Set(["level", "time", "msg"]);
// Libraries put addresses in messages (Better Auth: "Sign-up attempt for existing email: ...").
const EMAIL = /[^\s@<>()"',;:]+@[^\s@<>()"',;:]+\.[^\s@<>()"',;:]+/g;

const hideEmails = (text: string) => text.replace(EMAIL, "[email]");

function write(level: Level, msg: string, fields: LogFields = {}): void {
  if (level === "debug") return;
  const line: Record<string, Value> = {
    level,
    time: new Date().toISOString(),
    msg: hideEmails(String(msg)),
  };
  for (const [key, value] of Object.entries(fields)) {
    if (RESERVED.has(key)) continue;
    if (typeof value === "string") line[key] = hideEmails(value);
    else if (
      value === null ||
      typeof value === "number" ||
      typeof value === "boolean"
    )
      line[key] = value;
  }
  const text = JSON.stringify(line);
  if (level === "error") console.error(text);
  else if (level === "warn") console.warn(text);
  else console.log(text);
}

export const log = {
  debug: (msg: string, fields?: LogFields) => write("debug", msg, fields),
  info: (msg: string, fields?: LogFields) => write("info", msg, fields),
  warn: (msg: string, fields?: LogFields) => write("warn", msg, fields),
  error: (msg: string, fields?: LogFields) => write("error", msg, fields),
};
