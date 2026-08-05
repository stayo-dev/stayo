/**
 * Universal search ranking.
 *
 * Pure — no Prisma, no I/O — so the ordering the owner sees is testable
 * without a database. Every provider scores through these helpers rather than
 * inventing its own scale, which is what keeps a tenant result and a hostel
 * result comparable when they land in the same response.
 *
 * Priority, per product direction: exact name → phone → room → hostel → fuzzy.
 *
 * Scores are deliberately spread out (100/95/90… not 4/3/2) so a later
 * provider can slot a new match kind between two existing ones without
 * renumbering everything.
 */

export const SCORE = {
  EXACT_NAME: 100,
  EXACT_PHONE: 95,
  EXACT_ROOM: 90,
  EXACT_HOSTEL: 85,

  PREFIX_NAME: 70,
  PREFIX_PHONE: 65,
  PREFIX_ROOM: 60,
  PREFIX_HOSTEL: 55,

  CONTAINS_NAME: 40,
  CONTAINS_PHONE: 35,
  CONTAINS_ROOM: 30,
  CONTAINS_HOSTEL: 25,

  /** Matched something secondary — email, roll number, status word. */
  FUZZY: 10,

  NO_MATCH: 0,
} as const;

export type MatchField = 'name' | 'phone' | 'room' | 'hostel';

/** Digits only, so "+91 98765 43210" and "9876543210" compare equal. */
export function normalizePhone(value: string | null | undefined): string {
  return (value ?? '').replace(/\D/g, '');
}

function normalize(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

/**
 * Score one candidate string against the query for a given field kind.
 * Returns NO_MATCH (0) when it doesn't match at all.
 */
export function scoreField(query: string, candidate: string | null | undefined, field: MatchField): number {
  const q = normalize(query);
  if (!q) return SCORE.NO_MATCH;

  if (field === 'phone') {
    const qDigits = normalizePhone(query);
    const cDigits = normalizePhone(candidate);
    // A query with no digits can't be a phone match — otherwise every empty
    // digit-string would "contain" it and every tenant would rank as a phone hit.
    if (!qDigits || !cDigits) return SCORE.NO_MATCH;

    // Country code is noise here. Owners store the same number as
    // "9876543210", "+91 98765 43210" or "919876543210" and search whichever
    // they remember; all three are the same person and must rank as exact.
    // Compare on the national 10-digit tail as well as the raw digits.
    const tail = (d: string) => (d.length > 10 ? d.slice(-10) : d);
    const qTail = tail(qDigits);
    const cTail = tail(cDigits);

    if (cDigits === qDigits || cTail === qTail) return SCORE.EXACT_PHONE;
    if (cDigits.startsWith(qDigits) || cTail.startsWith(qTail)) return SCORE.PREFIX_PHONE;
    if (cDigits.includes(qDigits)) return SCORE.CONTAINS_PHONE;
    return SCORE.NO_MATCH;
  }

  const c = normalize(candidate);
  if (!c) return SCORE.NO_MATCH;

  const exact = { name: SCORE.EXACT_NAME, room: SCORE.EXACT_ROOM, hostel: SCORE.EXACT_HOSTEL }[field];
  const prefix = { name: SCORE.PREFIX_NAME, room: SCORE.PREFIX_ROOM, hostel: SCORE.PREFIX_HOSTEL }[field];
  const contains = { name: SCORE.CONTAINS_NAME, room: SCORE.CONTAINS_ROOM, hostel: SCORE.CONTAINS_HOSTEL }[field];

  if (c === q) return exact;
  if (c.startsWith(q)) return prefix;

  // For names, also treat a match at the start of any word as a prefix hit —
  // searching "sharma" should rank "Rahul Sharma" as a strong match, not a
  // weak substring one.
  if (field === 'name' && c.split(/\s+/).some((word) => word.startsWith(q))) return prefix;

  if (c.includes(q)) return contains;
  return SCORE.NO_MATCH;
}

/**
 * Best score across several candidate fields. A record matching on both name
 * and room takes the stronger of the two, never their sum — summing would let
 * three weak partial matches outrank one exact name.
 */
export function bestScore(
  query: string,
  candidates: { value: string | null | undefined; field: MatchField }[],
): number {
  // Annotated: `SCORE` is `as const`, so this would otherwise infer the
  // literal type `0` and reject every real score.
  let best: number = SCORE.NO_MATCH;
  for (const { value, field } of candidates) {
    const s = scoreField(query, value, field);
    if (s > best) best = s;
  }
  return best;
}

/**
 * Sort by score descending, then by a stable tiebreaker, so equal-scoring
 * results don't reshuffle between keystrokes.
 */
export function sortByScore<T extends { score: number; title: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
}
