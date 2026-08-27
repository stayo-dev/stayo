/**
 * The Stayo voice for resident- and guardian-facing WhatsApp.
 *
 * Every string a tenant or guardian reads passes through here. The rules below
 * are the whole point of this module — they are what separates a message that
 * gets a ₹8,000 transfer from one that gets ignored:
 *
 * 1. **Never apologise.** "Sorry, I didn't understand" tells the reader the
 *    system is unreliable. State what is true and what to do next instead.
 * 2. **Name the hostel, every time money is mentioned.** A message about rent
 *    from an unrecognised number is indistinguishable from a scam. The hostel's
 *    own name is the authority anchor, and it is the reason a parent taps a
 *    payment link at all.
 * 3. **Third person for guardians, second person for residents.** A parent
 *    reading "your rent is overdue" flinches at a debt that is not theirs;
 *    "Aarav's rent is overdue" is the same fact without the accusation.
 * 4. **Never print "N/A".** If a value is unknown, the sentence that needed it
 *    does not get written. `@/lib/format`'s date helpers return "N/A" on null,
 *    so every call here is null-guarded before it reaches them.
 * 5. **No decorative rules.** The old formatter drew `━━ Current Status ━━`
 *    around every section; on a phone that is four wasted lines per screen.
 *    WhatsApp's own `*bold*` carries the hierarchy.
 */

import { formatShortDate } from "@/lib/format";

/** Who is reading. Drives person, not permission — permission lives in the router. */
export type Audience = "RESIDENT" | "GUARDIAN";

export type Subject = {
  /** The resident this message is about. */
  name: string;
  /** Hostel name — the authority anchor. Never omitted from a money message. */
  hostelName: string;
  roomNo: string | null;
};

/** `₹8,000` — Indian grouping, no paise. Money is never printed bare. */
export function rupees(amount: number): string {
  const value = Number.isFinite(amount) ? Math.round(amount) : 0;
  return `₹${new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value)}`;
}

/** `12 Aug 2026`, or null — never the string "N/A". See rule 4. */
export function shortDate(date: Date | string | null | undefined): string | null {
  if (!date) return null;
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return null;
  return formatShortDate(parsed);
}

/** "3 days" / "1 day" — the unit agrees with the number, always. */
export function days(count: number): string {
  const n = Math.max(0, Math.round(count));
  return `${n} ${n === 1 ? "day" : "days"}`;
}

/**
 * "Aarav's" vs "your" — the possessive that opens most sentences here.
 * A guardian never reads "your rent"; that is rule 3, and it is the single
 * highest-leverage word choice in this file.
 */
export function possessive(audience: Audience, subject: Subject): string {
  if (audience === "RESIDENT") return "your";
  const name = subject.name.trim();
  if (!name) return "their";
  return name.endsWith("s") ? `${name}'` : `${name}'s`;
}

/**
 * The identity line that heads every money answer: who this is about and
 * where they live. A guardian supporting two children needs this to know
 * which child they are looking at *before* reading an amount — which is
 * exactly what the old 30-minute invisible "active resident" mode denied them.
 */
export function subjectLine(audience: Audience, subject: Subject): string {
  const place = subject.roomNo
    ? `${subject.hostelName}, Room ${subject.roomNo}`
    : subject.hostelName;
  if (audience === "RESIDENT") return `*${subject.hostelName}*${subject.roomNo ? ` · Room ${subject.roomNo}` : ""}`;
  return `*${subject.name}* · ${place}`;
}

/**
 * Closing attribution. The hostel signs its own messages — not "HMS", which
 * was a product name no reader has ever seen, printed at the bottom of every
 * rent template in the old system.
 */
export function signature(subject: Subject): string {
  return `— ${subject.hostelName}, via Stayo`;
}

/** Joins sections with a blank line, dropping anything empty. */
export function compose(...sections: Array<string | null | undefined>): string {
  return sections
    .map((section) => (section || "").trim())
    .filter(Boolean)
    .join("\n\n");
}

/** Joins lines within a section, dropping anything empty. */
export function lines(...items: Array<string | null | undefined>): string {
  return items
    .map((item) => (item || "").trim())
    .filter(Boolean)
    .join("\n");
}
