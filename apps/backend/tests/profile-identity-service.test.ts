import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    profile_identity: { findUnique: vi.fn(), upsert: vi.fn() },
    tenants: { findFirst: vi.fn() },
  },
  supabase: {},
}));

import { prisma } from "@/lib/db";
import { profileIdentityService } from "@/src/services/profile/profile-identity-service";

const identity = () => (prisma as any).profile_identity;
const tenants = () => (prisma as any).tenants;

beforeEach(() => vi.clearAllMocks());

/** getIdentity issues two tenancy lookups: live first, then most-recent. */
function mockTenancies({ live, latest }: { live?: any; latest?: any }) {
  tenants().findFirst.mockImplementation(async (args: any) => {
    const wantsLive = Array.isArray(args?.where?.status?.in);
    if (wantsLive) return live ?? null;
    return latest ?? null;
  });
}

describe("identity read: profile first, tenancy as fallback", () => {
  it("prefers the person's own record over any tenancy", async () => {
    identity().findUnique.mockResolvedValueOnce({ college_name: "Osmania University" });
    mockTenancies({ live: { college_name: "Somewhere Else" } });

    const result = await profileIdentityService.getIdentity("p1");

    expect(result.college_name).toBe("Osmania University");
    expect(result.pending_backfill_fields).not.toContain("college_name");
  });

  it("falls back to the tenancy for fields the profile has not got yet", async () => {
    identity().findUnique.mockResolvedValueOnce({ college_name: "Osmania University" });
    mockTenancies({ live: { college_name: "Ignored", guardian_name: "Ramesh Kumar" } });

    const result = await profileIdentityService.getIdentity("p1");

    expect(result.guardian_name).toBe("Ramesh Kumar");
    // Surfaced, so the end of the transition is observable rather than guessed.
    expect(result.pending_backfill_fields).toContain("guardian_name");
  });

  it("treats an empty string on the profile as absent, not as an answer", async () => {
    identity().findUnique.mockResolvedValueOnce({ guardian_name: "   " });
    mockTenancies({ live: { guardian_name: "Ramesh Kumar" } });

    const result = await profileIdentityService.getIdentity("p1");
    expect(result.guardian_name).toBe("Ramesh Kumar");
  });

  it("prefers a live tenancy over a more recent former one", async () => {
    // Regression: ordering by `status` ascending would have picked INVITED over
    // ACTIVE, because TenantStatus declares INVITED first.
    identity().findUnique.mockResolvedValueOnce(null);
    mockTenancies({
      live: { college_name: "Live Tenancy College" },
      latest: { college_name: "Former Tenancy College" },
    });

    const result = await profileIdentityService.getIdentity("p1");
    expect(result.college_name).toBe("Live Tenancy College");
  });

  it("uses the most recent tenancy when none is live", async () => {
    identity().findUnique.mockResolvedValueOnce(null);
    mockTenancies({ live: null, latest: { college_name: "Former Tenancy College" } });

    const result = await profileIdentityService.getIdentity("p1");
    expect(result.college_name).toBe("Former Tenancy College");
  });

  it("reports completeness from the core fields only", async () => {
    identity().findUnique.mockResolvedValueOnce({
      date_of_birth: new Date("2004-03-14"),
      gender: "Male",
      permanent_address: "Warangal",
      guardian_name: "Ramesh Kumar",
      guardian_phone: "919000000000",
      // Deliberately no college — a convenience gate must not demand everything.
    });
    mockTenancies({});

    const result = await profileIdentityService.getIdentity("p1");
    expect(result.is_complete).toBe(true);
    expect(result.missing_core_fields).toEqual([]);
  });

  it("lists what is missing when the core set is incomplete", async () => {
    identity().findUnique.mockResolvedValueOnce({ gender: "Male" });
    mockTenancies({});

    const result = await profileIdentityService.getIdentity("p1");
    expect(result.is_complete).toBe(false);
    expect(result.missing_core_fields).toContain("guardian_phone");
  });
});

describe("identity write", () => {
  beforeEach(() => {
    identity().upsert.mockResolvedValue({});
    identity().findUnique.mockResolvedValue({});
    mockTenancies({});
  });

  it("never writes a blank over an existing value", async () => {
    // Onboarding asks for a subset of these fields; treating absence as
    // "clear it" would let a short form wipe a longer one's answers.
    await profileIdentityService.update("p1", { college_name: "Osmania", guardian_name: "  " });

    const written = identity().upsert.mock.calls[0][0].update;
    expect(written).toHaveProperty("college_name", "Osmania");
    expect(written).not.toHaveProperty("guardian_name");
  });

  it("rejects an update with nothing usable in it", async () => {
    await expect(profileIdentityService.update("p1", { college_name: "" })).rejects.toThrow(/nothing to update/i);
  });

  it("rejects a future date of birth", async () => {
    const nextYear = new Date();
    nextYear.setFullYear(nextYear.getFullYear() + 1);
    await expect(
      profileIdentityService.update("p1", { date_of_birth: nextYear.toISOString() }),
    ).rejects.toThrow(/future/i);
  });

  it("rejects an unparseable date of birth", async () => {
    await expect(profileIdentityService.update("p1", { date_of_birth: "not-a-date" })).rejects.toThrow(
      /valid date/i,
    );
  });

  it("rejects an out-of-range year of study", async () => {
    await expect(profileIdentityService.update("p1", { year_of_study: 99 })).rejects.toThrow(/between 1 and 10/i);
  });

  it("rejects an unknown profile type", async () => {
    await expect(profileIdentityService.update("p1", { profile_type: "TOURIST" })).rejects.toThrow(
      /STUDENT or WORKING_PROFESSIONAL/i,
    );
  });

  it("trims strings before storing them", async () => {
    await profileIdentityService.update("p1", { college_name: "  Osmania  " });
    expect(identity().upsert.mock.calls[0][0].update.college_name).toBe("Osmania");
  });
});

describe("absorbing onboarding answers back into the portable profile", () => {
  beforeEach(() => {
    identity().upsert.mockResolvedValue({});
    identity().findUnique.mockResolvedValue({});
    mockTenancies({});
  });

  it("copies only the non-blank fields it recognises", async () => {
    await profileIdentityService.absorbFromTenancy("p1", {
      college_name: "Osmania",
      guardian_name: null,
      monthly_rent: 6000, // not an identity field — must not leak through
    });

    const written = identity().upsert.mock.calls[0][0].update;
    expect(written).toHaveProperty("college_name", "Osmania");
    expect(written).not.toHaveProperty("guardian_name");
    expect(written).not.toHaveProperty("monthly_rent");
  });

  it("does nothing when the tenancy has no identity data worth keeping", async () => {
    const result = await profileIdentityService.absorbFromTenancy("p1", { monthly_rent: 6000 });
    expect(result).toBeNull();
    expect(identity().upsert).not.toHaveBeenCalled();
  });
});
