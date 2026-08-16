/**
 * Admin-authored, per-section objections on a marketing submission.
 *
 * Distinct from the automated `ReviewFlag`s in marketing-review-service.ts:
 * those are computed advisories (price drift, sharing not in inventory) that
 * never block approval and are never stored. These are a human saying "this
 * part, change it", and they persist on the revision so the history records
 * what was objected to.
 *
 * PURE MODULE — no I/O, runs under vitest.pure.config.ts.
 */

export const REVIEW_SECTIONS = [
  "basics",
  "photos",
  "beds",
  "amenities",
  "places",
  "mess",
] as const;

export type ReviewSection = (typeof REVIEW_SECTIONS)[number];

export type SectionFlag = {
  section: ReviewSection;
  note: string | null;
  flagged_by: string;
  flagged_at: string;
};

/** The owner never sees our column names. */
const SECTION_LABEL: Record<ReviewSection, string> = {
  basics: "Name, tagline & about",
  photos: "Photos",
  beds: "Rooms & pricing",
  amenities: "Amenities",
  places: "Getting around",
  mess: "Mess menu",
};

const MAX_NOTE = 1000;

export function normaliseReviewFlags(raw: unknown, adminId: string): SectionFlag[] {
  if (!Array.isArray(raw)) return [];

  // Keyed by section so a double-click can't produce two objections to the
  // same part of the page; the last one wins.
  const bySection = new Map<ReviewSection, SectionFlag>();
  const now = new Date().toISOString();

  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const section = String((entry as any).section ?? "") as ReviewSection;
    if (!(REVIEW_SECTIONS as readonly string[]).includes(section)) continue;

    const rawNote = (entry as any).note;
    const note = rawNote == null ? null : String(rawNote).trim().slice(0, MAX_NOTE) || null;

    bySection.set(section, { section, note, flagged_by: adminId, flagged_at: now });
  }

  return Array.from(bySection.values());
}

/**
 * A send-back must tell the owner something. Either a flagged section (which
 * is itself an instruction — "this part") or a covering note. Neither means
 * the owner receives a bare "no" and resubmits the same page, which is what
 * ADR-076 set out to prevent.
 */
export function isSendBackActionable(flags: SectionFlag[], note: string | null | undefined): boolean {
  return flags.length > 0 || Boolean(note && note.trim());
}

/** Flags rendered as the body of the owner's notification. */
export function summariseFlagsForOwner(flags: SectionFlag[]): string {
  if (flags.length === 0) return "";
  return flags
    .map((flag) => {
      const label = SECTION_LABEL[flag.section];
      return flag.note ? `${label}: ${flag.note}` : label;
    })
    .join(" · ");
}
