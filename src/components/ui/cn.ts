/** Joins class names, skipping empty ones. */
export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}

/** The keyboard focus ring every interactive element shares. */
export const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

/** An inline text link: underlined (not color alone) with the shared focus ring. */
export const textLink = cn("rounded-sm text-primary underline", focusRing);

/**
 * A text link that stands alone rather than inside a sentence (a page's own links, an empty
 * state's way out): at least 44 px tall, so it's easy to tap on a phone.
 */
export const tapLink = cn(textLink, "inline-flex min-h-11 items-center");
