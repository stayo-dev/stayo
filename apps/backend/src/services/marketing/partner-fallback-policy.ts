/**
 * When a withheld enquiry stops being a sales tactic and starts being a
 * person left waiting.
 *
 * A HELD enquiry means a student asked about somewhere to live and we chose
 * not to pass it on, because their prospective landlord has not signed up.
 * That is defensible for a few hours as leverage. It is not defensible
 * indefinitely: it damages the demand side — the harder side of a
 * marketplace to rebuild — in order to coerce the supply side.
 *
 * So every held enquiry has a deadline, after which the student hears from
 * Stayo with places that ARE on Stayo. The gate becomes a lead
 * redistribution engine that rewards the owners who joined.
 *
 * PURE MODULE — no I/O, runs under vitest.pure.config.ts.
 */

/**
 * Hours a student may be left waiting before we step in.
 *
 * The sweep runs **once daily** — Vercel's Hobby plan rejects anything more
 * frequent at deploy time — so this is when an enquiry becomes *eligible*,
 * not when the message goes out. Worst case is this threshold plus one
 * sweep interval: eligible at 12h, rescued somewhere between 12h and 36h.
 * A 6-hourly schedule, if the plan ever allows one, tightens that to 18h
 * with no code change.
 */
export const FALLBACK_THRESHOLD_HOURS = 12;

/** Nobody wants a list. Three is a choice; ten is a search results page. */
export const MAX_ALTERNATIVES = 3;

export type HeldDelivery = {
  state: string;
  created_at: Date | string;
  fallback_at?: Date | string | null;
};

/**
 * Only a still-held, not-yet-rescued enquiry that has passed the threshold.
 *
 * Deliberately re-checks `state` rather than trusting the query that found
 * it: a claim between the sweep's read and its write releases the enquiry,
 * and telling a student about alternatives moments after their actual choice
 * became reachable would be worse than saying nothing.
 */
export function isFallbackDue(
  delivery: HeldDelivery,
  options: { now?: Date; thresholdHours?: number } = {}
): boolean {
  if (delivery.state !== "HELD") return false;
  if (delivery.fallback_at) return false;

  const threshold = normaliseHours(options.thresholdHours);
  const created = new Date(delivery.created_at as any).getTime();
  if (!Number.isFinite(created)) return false;

  const now = (options.now ?? new Date()).getTime();
  return now - created >= threshold * 60 * 60 * 1000;
}

export type AlternativeHostel = {
  id: string;
  name: string;
  city?: string | null;
  public_slug?: string | null;
};

/**
 * Picks what to actually offer the student.
 *
 * Excludes the hostel they enquired about — it is still their first choice,
 * and listing it back to them reads as a system that was not paying
 * attention. Anything without a public slug is dropped: a recommendation
 * they cannot open is worse than one fewer recommendation.
 */
export function selectAlternatives(
  candidates: AlternativeHostel[],
  options: { excludeHostelId: string; limit?: number }
): AlternativeHostel[] {
  const limit = Math.max(0, Math.floor(options.limit ?? MAX_ALTERNATIVES));
  return (candidates ?? [])
    .filter((h) => h && h.id !== options.excludeHostelId && !!h.public_slug)
    .slice(0, limit);
}

function normaliseHours(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return FALLBACK_THRESHOLD_HOURS;
  return n;
}

/**
 * What the student is told.
 *
 * Says nothing about the owner not having signed up. That is our commercial
 * situation, not theirs, and framing a delay as somebody else's failure
 * invites them to chase a hostel we have just told them is unreachable.
 */
export function buildFallbackMessage(input: {
  studentName: string;
  hostelName: string;
  alternatives: AlternativeHostel[];
}): { subject: string; body: string } {
  const name = String(input.studentName || "").trim().split(/\s+/)[0] || "there";
  const alternatives = input.alternatives ?? [];

  const subject = alternatives.length
    ? `Other hostels near ${input.hostelName}`
    : `Your enquiry about ${input.hostelName}`;

  const opening = `Hi ${name}, we passed your enquiry about ${input.hostelName} on and have not heard back yet.`;

  const body = alternatives.length
    ? `${opening} While you wait, these are on Stayo and taking enquiries now:\n\n` +
      alternatives.map((h) => `• ${h.name}${h.city ? `, ${h.city}` : ""}`).join("\n")
    : `${opening} We will let you know the moment they reply.`;

  return { subject, body };
}
