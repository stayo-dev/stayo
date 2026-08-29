/**
 * Tidying what an owner types, as they type it.
 *
 * Most people running a hostel are not typing on a laptop with a careful eye
 * on capitalisation — they are entering "ramesh kumar", "GROUND FLOOR", "  idly
 * " on a phone, one-handed, between other jobs. That text then appears on a
 * tenant's agreement, on a receipt, in a WhatsApp message and on a public
 * listing, where it reads as sloppiness on the hostel's part rather than on
 * ours.
 *
 * So the app tidies it instead of asking the owner to. The rules below are
 * deliberately conservative: they fix case and spacing, and they never change
 * which characters a person typed. Anything cleverer — guessing that "dosa" is
 * really "Dosa (plain)", expanding abbreviations — would eventually rewrite
 * somebody's name or dish into something they did not mean, and being wrong
 * about a person's name is worse than leaving it lowercase.
 *
 * Applied on **blur**, not on every keystroke: capitalising mid-word while
 * someone is still typing moves the caret and fights them. See ADR-142.
 */

/**
 * Particles that stay lowercase inside a longer name — "Ramesh bin Abdullah",
 * "Nair de Souza". Kept small on purpose: an over-eager list starts
 * lower-casing real given names.
 */
const LOWERCASE_PARTICLES = new Set(['bin', 'binti', 'de', 'del', 'della', 'da', 'di', 'van', 'von', 'der', 'la', 'le']);

/** Collapses runs of whitespace and trims the ends. Never touches the middle words. */
export function collapseSpaces(value: string): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * Capitalises the first letter of each word, leaving the rest of the word as
 * typed — so "McDonald" and "iPhone" survive, while "ramesh" becomes "Ramesh".
 *
 * A word typed in ALL CAPS is lowered first: "GROUND FLOOR" almost always
 * means the caps lock was on, not that the owner wanted shouting on a receipt.
 * A word with internal capitals is left alone, since that is deliberate.
 */
function capitalizeWord(word: string): string {
  if (!word) return word;
  const isAllCaps = word.length > 1 && word === word.toUpperCase() && /[A-Z]/.test(word);
  const base = isAllCaps ? word.toLowerCase() : word;
  return base.charAt(0).toUpperCase() + base.slice(1);
}

/**
 * Title-cases free text: dish names, room labels, expense titles, hostel names.
 *
 * Splits on spaces, hyphens and slashes so "sambar-rice" and "veg/non-veg"
 * read correctly, and preserves the separator that was typed.
 */
export function titleCaseText(value: string): string {
  const collapsed = collapseSpaces(value);
  if (!collapsed) return '';

  return collapsed
    .split(' ')
    .map((word) =>
      word
        .split(/([-/])/)
        .map((part) => (part === '-' || part === '/' ? part : capitalizeWord(part)))
        .join(''),
    )
    .join(' ');
}

/**
 * A person's name. Same as `titleCaseText`, except that a small set of
 * particles stays lowercase when it is not the first word.
 *
 * Never applied to a name the person themselves supplied — a tenant's own
 * spelling of their own name is theirs, and this only tidies what an *owner*
 * typed on their behalf.
 */
export function titleCaseName(value: string): string {
  const collapsed = collapseSpaces(value);
  if (!collapsed) return '';

  return collapsed
    .split(' ')
    .map((word, index) => {
      const lower = word.toLowerCase();
      if (index > 0 && LOWERCASE_PARTICLES.has(lower)) return lower;
      return capitalizeWord(word);
    })
    .join(' ');
}

/**
 * Sentence case for longer free text — notes, descriptions, rules.
 *
 * Only the first letter is touched. Title-casing a whole sentence produces the
 * "Please Pay Your Rent By The Fifth" look that reads as a machine wrote it.
 */
export function sentenceCaseText(value: string): string {
  const collapsed = collapseSpaces(value);
  if (!collapsed) return '';
  return collapsed.charAt(0).toUpperCase() + collapsed.slice(1);
}

/**
 * The live variant, safe to run on every keystroke.
 *
 * Uppercases the first letter after each space and touches nothing else — so
 * the string never changes length and the caret does not jump. That is the
 * whole reason it is separate from `titleCaseText`, which trims and collapses
 * spaces and would therefore eat the space a person just typed and refuse to
 * let them start the next word.
 *
 * Use this for `onChange`; use `titleCaseText` on `onBlur` or on submit.
 */
export function capitalizeWordsLive(value: string): string {
  return String(value ?? '').replace(/(^|\s)([a-z])/g, (_match, sep, char) => sep + char.toUpperCase());
}
