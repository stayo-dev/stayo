/**
 * Which identity fields onboarding still has to ask an invitee for.
 *
 * Same principle as the phone and the email (ADR-110): do not ask for what the
 * system already knows. A hostel that only takes boys has already answered
 * "what is this person's gender" by admitting them — putting the question on
 * the form adds a tap, and adds a way for the record to disagree with the
 * hostel it belongs to.
 *
 * The rule is deliberately narrow. Gender is derived **only** when the hostel
 * type states it outright, and every other value — co-living, working
 * professionals, or a hostel whose type was never set — still asks. That
 * matters more than it looks: `hostels.hostel_type` is nullable and, as of
 * 2026-08-25, is NULL on half the hostels in production. Guessing for those
 * would write a gender nobody supplied into a permanent tenant record.
 */

/** The values `hostels.hostel_type` is written with; it is a plain nullable String. */
export type HostelTypeCode = "BOYS" | "GIRLS" | "CO_LIVING" | "WORKING_PROS";

/** What `tenants.gender` accepts. */
export type TenantGender = "Male" | "Female" | "Other" | "Prefer not to say";

/**
 * The gender a hostel's own type establishes, or null when it establishes
 * nothing. Null is the common case and must stay cheap to handle.
 */
export function deriveGenderFromHostelType(hostelType: unknown): TenantGender | null {
  const code = String(hostelType || "").trim().toUpperCase();
  if (code === "BOYS") return "Male";
  if (code === "GIRLS") return "Female";
  // CO_LIVING and WORKING_PROS admit any gender; an unset type tells us
  // nothing at all. Both must be asked, not assumed.
  return null;
}

export type GenderRequirement = {
  /** Whether the Identity screen must render the gender selector. */
  required: boolean;
  /** The value to use when it must not — already known, so never asked. */
  value: TenantGender | null;
  /** Why, so the screen can explain itself rather than silently dropping a field. */
  reason: "already_recorded" | "implied_by_hostel" | "must_ask";
};

/**
 * Resolve the requirement for one tenancy.
 *
 * A gender already on the tenant record wins over the hostel type: it was
 * supplied by a person, and re-deriving could overwrite a deliberate answer
 * (someone recorded as "Other" in a boys' hostel, say) with a guess.
 */
export function resolveGenderRequirement(input: {
  tenantGender: unknown;
  hostelType: unknown;
}): GenderRequirement {
  const existing = String(input.tenantGender || "").trim();
  if (existing) return { required: false, value: existing as TenantGender, reason: "already_recorded" };

  const implied = deriveGenderFromHostelType(input.hostelType);
  if (implied) return { required: false, value: implied, reason: "implied_by_hostel" };

  return { required: true, value: null, reason: "must_ask" };
}
