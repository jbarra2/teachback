// The one place app code writes logs (CLAUDE.md, TESTING §8). One JSON line per entry. Fields
// take plain values only, so an error object, a request body or a connection string can't end up
// in a log by accident: log an error's `name`, never the error. On top of that (T14), secrets are
// redacted by field name and by what they look like, and fields that could hold a student's
// notes or answer are never written.

type Level = "debug" | "info" | "warn" | "error";
type Value = string | number | boolean | null | undefined;
export type LogFields = Record<string, Value>;

const RESERVED = new Set(["level", "time", "msg"]);
// Libraries put addresses in messages (Better Auth: "Sign-up attempt for existing email: ...").
// Brackets aren't part of an address, so a redacted URL's "[redacted]@host" isn't read as one.
const EMAIL = /[^\s@<>()"',;:[\]]+@[^\s@<>()"',;:]+\.[^\s@<>()"',;:]+/g;

const REDACTED = "[redacted]";

/** Field names whose values are credentials: cookies, sessions, auth headers, tokens, secrets, keys. */
const SECRET_KEY =
  /cookie|session|authorization|token|secret|password|api[-_]?key/i;
/**
 * Field names that could carry note or answer text, which never goes in a log (CLAUDE.md). Matched
 * anywhere in the name, so a later `studentAnswer` or `chunkText` is caught too.
 */
const CONTENT_KEY =
  /text|note|answer|content|body|prompt|question|feedback|excerpt|quote|chunk/i;

/** Secrets by their shape, wherever they turn up in a message or a value. */
const SECRET_VALUES: [RegExp, string][] = [
  // Anthropic API keys.
  [/sk-ant-[A-Za-z0-9_-]+/g, REDACTED],
  // Authorization: Bearer <token> or Basic <credentials>.
  [/\b(Bearer|Basic)\s+[^\s,;]+/gi, `$1 ${REDACTED}`],
  // Better Auth's session cookie, with or without the __Secure- prefix, and similar name=value pairs.
  [
    /([\w.-]*(?:token|session|secret|password|api_?key)[\w.-]*)=([^\s&;,]+)/gi,
    `$1=${REDACTED}`,
  ],
  // The same names in JSON or after a colon: {"password":"x"}, token: abc, secret: 'x'.
  [
    /(["']?[\w.-]*(?:token|session|secret|password|api_?key)[\w.-]*["']?\s*:\s*["']?)[^\s"',;}]+/gi,
    `$1${REDACTED}`,
  ],
  // Credentials in a URL (the user:password@ part of a database URL): only the host is kept.
  [/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+(?::[^\s/@]*)?@/gi, `$1${REDACTED}@`],
];

function redact(text: string): string {
  // Secrets first: a URL's "user:password@host" would otherwise be taken for an address.
  let out = text;
  for (const [pattern, replacement] of SECRET_VALUES)
    out = out.replace(pattern, replacement);
  return out.replace(EMAIL, "[email]");
}

function write(level: Level, msg: string, fields: LogFields = {}): void {
  if (level === "debug") return;
  const line: Record<string, Value> = {
    level,
    time: new Date().toISOString(),
    msg: redact(String(msg)),
  };
  for (const [key, value] of Object.entries(fields)) {
    if (RESERVED.has(key)) continue;
    const plain =
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean" ||
      value === null;
    if (!plain) continue;
    if (SECRET_KEY.test(key) || CONTENT_KEY.test(key)) line[key] = REDACTED;
    else line[key] = typeof value === "string" ? redact(value) : value;
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
