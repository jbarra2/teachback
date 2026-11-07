// Untrusted text (notes, titles, labels, answers, earlier questions) goes into prompts as data
// inside tags (PLAN §8). Escaping keeps it from closing a tag or forging a new one.

/** For text between tags: &, < and >. */
export const escapeText = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** For a quoted attribute value: the same, plus ". */
export const escapeAttribute = (value: string) =>
  escapeText(value).replace(/"/g, "&quot;");

/** Cuts text to at most `max` characters (code points). */
export const cut = (text: string, max: number) =>
  [...text].slice(0, max).join("");
