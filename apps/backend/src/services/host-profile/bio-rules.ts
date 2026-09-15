/**
 * What an owner may say about themselves on a public listing (ADR-200).
 *
 * Pure — no I/O — so the rules are assertable without a database and are
 * applied identically to the owner's own edits and to an admin's.
 *
 * The contact-detail rule is the load-bearing one. A public listing is not
 * where an owner's phone number goes: a resident who rings the number in a bio
 * has left Stayo, and with it the record of what was agreed. Admins are held
 * to the same rule — it protects the platform, not the owner.
 */

export const HOST_LANGUAGES = [
  "Telugu", "Hindi", "English", "Tamil", "Kannada", "Malayalam",
  "Marathi", "Urdu", "Bengali", "Gujarati", "Punjabi", "Odia",
] as const;

export const BIO_MAX_CHARS = 500;
export const LANGUAGES_MAX = 6;
export const HOSTING_SINCE_MIN = 1950;

export type RuleResult<T> = { ok: true; value: T } | { ok: false; reason: string };

const REACH_US = "residents reach you through Stayo.";
const PHONE_RUN = /\d{10,}/;
const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;
// The bare-domain label needs 2+ characters so degrees read as prose:
// "B.Com and M.Com students" is a hostel's audience, not a website.
const LINK = /https?:\/\/|www\.|wa\.me|\b[a-z0-9-]{2,}\.(com|in|net|org|co|me|io|app|link|info|biz)\b/i;
const HANDLE = /(^|\s)@[a-z0-9_.]{3,}/i;

/** "98765 43210", "(040) 2345-6789" — digits split by separators read as one number. */
function joinDigitRuns(text: string): string {
  return text.replace(/(\d)[\s\-.()]+(?=\d)/g, "$1");
}

/** The owner-facing reason a text is refused, or null when it carries no contact details. */
export function containsContactDetails(text: string): string | null {
  if (PHONE_RUN.test(joinDigitRuns(text))) return `Remove the phone number — ${REACH_US}`;
  if (EMAIL.test(text)) return `Remove the email address — ${REACH_US}`;
  if (LINK.test(text)) return `Remove the link — ${REACH_US}`;
  if (HANDLE.test(text)) return `Remove the social media handle — ${REACH_US}`;
  return null;
}

/** Keeps paragraphs, drops trailing spaces and runs of blank lines. */
export function normaliseBio(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function validateBio(input: unknown): RuleResult<string | null> {
  if (input === null || input === undefined) return { ok: true, value: null };
  if (typeof input !== "string") return { ok: false, reason: "Your story must be text." };
  const value = normaliseBio(input);
  if (value.length === 0) return { ok: true, value: null };
  if (value.length > BIO_MAX_CHARS) {
    return { ok: false, reason: `Keep it under ${BIO_MAX_CHARS} characters — this is ${value.length}.` };
  }
  const contact = containsContactDetails(value);
  if (contact) return { ok: false, reason: contact };
  return { ok: true, value };
}

export function validateLanguages(input: unknown): RuleResult<string[]> {
  if (input === null || input === undefined) return { ok: true, value: [] };
  if (!Array.isArray(input)) return { ok: false, reason: "Languages must be a list." };
  const known = new Set<string>(HOST_LANGUAGES);
  const value: string[] = [];
  for (const item of input) {
    if (typeof item !== "string" || !known.has(item)) return { ok: false, reason: "Pick languages from the list." };
    if (!value.includes(item)) value.push(item);
  }
  if (value.length > LANGUAGES_MAX) return { ok: false, reason: `Pick up to ${LANGUAGES_MAX} languages.` };
  return { ok: true, value };
}

export function validateHostingSince(input: unknown, now: Date = new Date()): RuleResult<number | null> {
  if (input === null || input === undefined || input === "") return { ok: true, value: null };
  const year = typeof input === "string" ? Number(input) : input;
  if (typeof year !== "number" || !Number.isInteger(year)) return { ok: false, reason: "Pick a year." };
  const latest = now.getFullYear();
  if (year < HOSTING_SINCE_MIN || year > latest) {
    return { ok: false, reason: `Pick a year between ${HOSTING_SINCE_MIN} and ${latest}.` };
  }
  return { ok: true, value: year };
}

/**
 * The whole name, tidied — how a host card names the owner (ADR-200). Lives
 * here, in the pure module, so the listing projection can use it without
 * pulling a database client into its import graph.
 */
export function fullName(name: string | null | undefined): string | null {
  const value = String(name ?? "").trim().replace(/\s+/g, " ");
  return value.length > 0 ? value : null;
}

/** Same floor as `propertyService.updateOwnerProfile` (2 chars), plus a ceiling. */
export function validateDisplayName(input: unknown): RuleResult<string> {
  if (typeof input !== "string") return { ok: false, reason: "Name must be text." };
  const value = input.trim().replace(/\s+/g, " ");
  if (value.length < 2) return { ok: false, reason: "Name must be at least 2 characters." };
  if (value.length > 80) return { ok: false, reason: "Name must be 80 characters or fewer." };
  return { ok: true, value };
}
