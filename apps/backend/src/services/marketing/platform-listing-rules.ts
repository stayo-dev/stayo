/**
 * Rules for claiming a Stayo-authored listing on behalf of its real owner.
 *
 * PURE MODULE — no I/O, runs under vitest.pure.config.ts.
 */

export type ClaimGuardResult = { ok: true } | { ok: false; reason: string };

export type ClaimableHostel = {
  listing_source?: string | null;
  claimed_at?: Date | null;
};

/**
 * Claiming applies ONLY to a platform listing nobody operates yet.
 *
 * A hostel a real owner already runs carries tenants, obligations and payouts.
 * Moving it to a different owner is a genuinely dangerous operation with its
 * own consequences, and it must never share a code path with handing over an
 * empty listing — so this refuses rather than quietly doing something adjacent.
 */
export function canClaimListing(hostel: ClaimableHostel): ClaimGuardResult {
  // Defaulting an absent value to OWNER_MANAGED is deliberate: every hostel
  // predating migration 068 has no listing_source, and defaulting the other
  // way would make the entire existing estate claimable.
  const source = String(hostel.listing_source ?? "OWNER_MANAGED");

  if (source !== "PLATFORM_LISTED") {
    return {
      ok: false,
      reason:
        "This hostel is already operated by an owner on Stayo. Transferring a live hostel moves its tenants and payments and is not done here.",
    };
  }

  if (hostel.claimed_at) {
    return { ok: false, reason: "This listing has already been claimed." };
  }

  return { ok: true };
}

/**
 * The claim payload. Deliberately does NOT touch `listing_status` or
 * `verification_status`: claiming decides who owns the listing, not whether it
 * is discoverable. Conflating them would let a claim silently publish, or
 * silently unpublish, a listing that was already live.
 */
export function buildClaimUpdate(ownerId: string, at: Date) {
  return {
    owner_id: ownerId,
    listing_source: "OWNER_MANAGED" as const,
    claimed_at: at,
    claimed_by: ownerId,
    updated_at: at,
  };
}
