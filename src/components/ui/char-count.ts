/**
 * Characters as the server counts them (`text()` in src/lib/schemas/common.ts): trimmed first,
 * then by code point, so an emoji is 1 and surrounding spaces are 0.
 *
 * Fields keep the native `maxLength` too. It counts UTF-16 units, which are never fewer than code
 * points, so it can stop typing a little early (emoji, padding) but never lets an over-limit
 * value through.
 */
export function charCount(value: string): number {
  return [...value.trim()].length;
}
