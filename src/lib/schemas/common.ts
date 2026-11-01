// Building blocks for the request schemas. They mirror openapi/openapi.yaml (PLAN §7):
// tests/contract/request-schemas.test.ts derives its cases from the spec, so the two can't drift.
import { z } from "zod";

/**
 * PLAN §7 limits, for the server and the UI. The server reads the upload and note limits from
 * MAX_UPLOAD_MB and MAX_NOTE_CHARS; these are their defaults (.env.example), for client-side checks.
 * `uploadBytes` caps the whole multipart request, so a client check on the file alone needs headroom.
 */
export const LIMITS = {
  courseName: 120,
  documentTitle: 200,
  answer: 4000,
  jsonBodyBytes: 64 * 1024,
  uploadBytes: 4 * 1024 * 1024,
  noteChars: 200_000,
} as const;

/** Prisma's `cuid()`: "c" and 24 lowercase letters or digits. */
export const ID_PATTERN = /^c[a-z0-9]{24}$/;

export const Id = z.string().regex(ID_PATTERN, "Must be a valid id.");

/** Path parameters of every route with an `{id}`. */
export const IdParams = z.object({ id: Id }).strict();

// Counted in characters (code points), as PostgreSQL's varchar does, not UTF-16 units.
const characters = (value: string) => [...value].length;

// An unpaired surrogate isn't valid UTF-8. A regex rather than String#isWellFormed, which browsers
// Next 16 supports (Firefox before 119) lack, since these schemas may also run in the UI.
const LONE_SURROGATE =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/**
 * User text: trimmed first, and the trimmed value is what gets stored. Must keep at least one
 * character, and can't hold NUL or an unpaired surrogate, which PostgreSQL would refuse with a 500.
 * `max` is left out where a longer text is a 413, not a 400 (note text, TESTING §3).
 */
export function text(max?: number) {
  const base = z
    .string()
    .refine(
      (value) => !LONE_SURROGATE.test(value) && !value.includes("\u0000"),
      {
        message: "Contains characters that aren't allowed.",
        abort: true,
      },
    )
    .trim()
    .min(1, "Can't be empty.");
  return max === undefined
    ? base
    : base.refine((value) => characters(value) <= max, {
        message: `Must be at most ${max} characters.`,
      });
}
