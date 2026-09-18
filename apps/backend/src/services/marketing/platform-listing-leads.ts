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
    /**
     * Nobody at this hostel asked to be contacted — the lead exists because
     * tenants enquired. Without this the row inherits the WEBSITE default and
     * the Leads screen shows it beside owners who filled in the form
     * themselves, which is the difference between a cold call and a callback
     * (migration 087).
     */
    acquisition_source: "DISCOVER_DEMAND" as const,
    notes: `${MARKER} · 1 enquiry from Discovery`,
  };
}

const REFERRAL_MARKER = "Student referral";

export type HostelReferral = {
  hostelName: string;
  /** The owner's number, if the student happened to know it. */
  ownerContact?: string | null;
};

/**
 * A student naming a hostel on the public homepage is the same shape as a
 * Discover enquiry: the OWNER is the prospect and the student is the evidence.
 *
 * The student-supplied owner number is written into the notes rather than
 * `phone`, for two reasons. The owner never opted in to being contacted by
 * us — putting it in `phone` would let outreach tooling treat it as consent —
 * and `platform_leads_one_active_lead_per_phone` would collide the moment two
 * students referred hostels sharing a number. Empty `phone` is excluded from
 * that index, which is why the Discover path already uses it.
 */
export function buildPlatformLeadFromReferral(referral: HostelReferral) {
  const name = referral.hostelName.trim();
  return {
    name,
    hostel_name: name,
    city: null as string | null,
    phone: "",
    status: "NEW" as const,
    acquisition_source: "STUDENT_REFERRAL" as const,
    notes: referralNote(null, referral.ownerContact ?? null),
  };
}

/**
 * Append a referral to a lead's notes, preserving anything an admin wrote.
 *
 * The count matters: "four students referred this hostel" is the pitch when we
 * finally call the owner, exactly as the enquiry tally is for Discover.
 */
export function referralNote(existing: string | null | undefined, ownerContact: string | null): string {
  const text = (existing ?? "").trim();
  const line = new RegExp(`${REFERRAL_MARKER} · (\\d+) referrals?`);
  const match = text.match(line);

  const contactSuffix = ownerContact ? ` · owner number given: ${ownerContact} (unverified, not opted in)` : "";

  if (!match) {
    const prefix = text ? `${text}\n` : "";
    return `${prefix}${REFERRAL_MARKER} · 1 referral${contactSuffix}`;
  }

  const next = Number(match[1]) + 1;
  const bumped = text.replace(line, `${REFERRAL_MARKER} · ${next} referrals`);
  // A number we did not have before is worth appending even on a repeat.
  return ownerContact && !bumped.includes(ownerContact) ? `${bumped}${contactSuffix}` : bumped;
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
