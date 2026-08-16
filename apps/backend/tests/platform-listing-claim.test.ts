import { describe, it, expect } from "vitest";
import { canClaimListing, buildClaimUpdate } from "@/src/services/marketing/platform-listing-rules";

const OWNER = "22222222-2222-2222-2222-222222222222";

describe("canClaimListing", () => {
  it("allows claiming an unclaimed platform listing", () => {
    expect(canClaimListing({ listing_source: "PLATFORM_LISTED", claimed_at: null }).ok).toBe(true);
  });

  /**
   * The guard that matters. Reassigning a hostel a real owner already runs
   * moves their tenants, obligations and payouts to somebody else. That is a
   * different and far more dangerous operation, and it must never share a
   * code path with claiming an empty listing.
   */
  it("refuses an owner-managed hostel, whatever else is true of it", () => {
    const result = canClaimListing({ listing_source: "OWNER_MANAGED", claimed_at: null });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/already operated|owner/i);
  });

  it("refuses a listing that was already claimed", () => {
    const result = canClaimListing({
      listing_source: "PLATFORM_LISTED",
      claimed_at: new Date("2026-08-01"),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/already been claimed/i);
  });

  it("treats a missing listing_source as owner-managed — the safe default", () => {
    // Every pre-existing hostel predates this column. Defaulting the other way
    // would make the whole existing estate claimable.
    expect(canClaimListing({ listing_source: undefined, claimed_at: null }).ok).toBe(false);
  });
});

describe("buildClaimUpdate", () => {
  const at = new Date("2026-08-16T12:00:00Z");

  it("moves ownership and flips the source in one payload", () => {
    const update = buildClaimUpdate(OWNER, at);
    expect(update.owner_id).toBe(OWNER);
    expect(update.listing_source).toBe("OWNER_MANAGED");
  });

  it("records who claimed it and when, so the transfer is auditable", () => {
    const update = buildClaimUpdate(OWNER, at);
    expect(update.claimed_by).toBe(OWNER);
    expect(update.claimed_at).toEqual(at);
  });

  it("never touches listing_status or verification_status — claiming is not approving", () => {
    const update = buildClaimUpdate(OWNER, at) as Record<string, unknown>;
    expect(update).not.toHaveProperty("listing_status");
    expect(update).not.toHaveProperty("verification_status");
  });
});
