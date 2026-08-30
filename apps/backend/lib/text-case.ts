/**
 * Title-casing for text an owner typed, on documents this backend renders.
 *
 * **A deliberate mirror of `apps/frontend/src/shared/lib/textFormat.ts`.** The
 * two apps have no shared package, so the alternative to duplicating ~15 lines
 * is publishing one — which is not worth it for this, but the duplication is
 * real and should be kept in step: the rules are stated once, in ADR-142, and
 * both copies implement that ADR rather than each other.
 *
 * Why the backend needs it at all: dish names created before ADR-142 are
 * stored exactly as typed ("bonda", "idly"), and the printed weekly menu is
 * the surface where that looks careless. Display is corrected; the stored
 * value is never rewritten, because reformatting somebody's data on read is a
 * different and much larger decision than formatting it on a document.
 */

/**
 * Capitalises the first letter of a word, leaving the rest as typed — so
 * "McDonald" survives. A word in ALL CAPS is lowered first, because caps lock
 * is nearly always an accident rather than emphasis.
 */
function capitalizeWord(word: string): string {
  if (!word) return word;
  const isAllCaps = word.length > 1 && word === word.toUpperCase() && /[A-Z]/.test(word);
  const base = isAllCaps ? word.toLowerCase() : word;
  return base.charAt(0).toUpperCase() + base.slice(1);
}

/**
 * Title-cases free text, splitting on spaces, hyphens and slashes so
 * "sambar-rice" and "veg/non-veg" read correctly, and preserving the
 * separator that was typed. Collapses runs of whitespace and trims.
 */
export function titleCaseText(value: string | null | undefined): string {
  const collapsed = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!collapsed) return "";

  return collapsed
    .split(" ")
    .map((word) =>
      word
        .split(/([-/])/)
        .map((part) => (part === "-" || part === "/" ? part : capitalizeWord(part)))
        .join(""),
    )
    .join(" ");
}
