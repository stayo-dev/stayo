/**
 * Turning tenant demand on an unclaimed Stayo listing into a sales lead.
 *
 * The loop this serves: Stayo lists a hostel for coverage → tenants enquire →
 * that demand becomes the pitch when we approach the owner ("six people asked
 * about your hostel this month") → the owner joins → they claim the listing
 * and inherit the enquiries.
 *
 * PURE MODULE — no I/O, runs under vitest.pure.config.ts.
 */

const MARKER = "Stayo-listed";

export type EnquiredHostel = {
  id: string;
  name: string;
  city?: string | null;
  listing_source?: string | null;
};

/**
 * Only unclaimed platform listings raise a lead. A hostel a real owner runs
 * delivers the enquiry to them directly — creating a sales lead there would
 * mean prospecting an existing customer.
 *
 * An absent `listing_source` is treated as OWNER_MANAGED, matching
 * platform-listing-rules.ts: every hostel predating migration 068 has no value
 * in that column, and the safe reading is "somebody owns this".
 */
export function shouldRaisePlatformLead(hostel: EnquiredHostel): boolean {
  return String(hostel.listing_source ?? "OWNER_MANAGED") === "PLATFORM_LISTED";
}

export function buildPlatformLeadFromEnquiry(hostel: EnquiredHostel) {
  return {
    // The lead is the hostel owner we want to sign up. The tenant who enquired
    // is the evidence, not the prospect — naming the lead after them would put
    // the wrong person in the sales pipeline.
    name: hostel.name,
    hostel_name: hostel.name,
    city: hostel.city ?? null,
    /**
     * Empty on purpose. A platform listing's contact number belongs to the
     * business, not to a person who agreed to be contacted by us. Copying it
     * into a lead's `phone` would let the outreach tooling treat it as an
     * opted-in number.
     */
    phone: "",
    status: "NEW" as const,
    notes: `${MARKER} · 1 enquiry from Discovery`,
  };
}

/**
 * Increment the enquiry tally on an existing lead's notes, preserving whatever
 * an admin has written above it.
 */
export function bumpEnquiryNote(existing: string | null | undefined): string {
  const text = existing ?? "";
  const line = new RegExp(`${MARKER} · (\\d+) enquir(?:y|ies) from Discovery`);
  const match = text.match(line);

  if (!match) {
    const prefix = text.trim() ? `${text.trim()}\n` : "";
    return `${prefix}${MARKER} · 1 enquiry from Discovery`;
  }

  const next = Number(match[1]) + 1;
  return text.replace(
    line,
    `${MARKER} · ${next} ${next === 1 ? "enquiry" : "enquiries"} from Discovery`,
  );
}
