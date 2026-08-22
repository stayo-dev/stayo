import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: { profile_identity: {} },
  supabase: {},
}));

import { buildKnown } from "@/src/services/tenants/onboarding-known";

const identity = (over: Record<string, unknown> = {}) => ({
  date_of_birth: null, gender: null, nationality: null, pan_number: null,
  permanent_address: null, photo_url: null, personal_email: null,
  guardian_name: null, guardian_phone: null, guardian_relation: null,
  profile_type: "STUDENT", college_name: null, roll_number: null, course: null,
  year_of_study: null, branch: null, section: null, office_name: null,
  office_location: null, job_role: null,
  is_complete: false, missing_core_fields: [], completion_percent: 0,
  pending_backfill_fields: [] as string[], has_profile_record: false,
  ...over,
});

describe("buildKnown", () => {
  it("prefers the profile over the invitation for name, email and phone", () => {
    const known = buildKnown({
      profile: { id: "p1", name: "Asha", email: "asha@example.com", phone: "+919876543210", mobile_verified: true, phone_verified: false },
      tenant: { phone_1: "9000000000" },
      invitation: { name: "A. Kumar", email: "invited@example.com", phone: "9111111111" },
      identity: identity(),
    });
    expect(known.name).toBe("Asha");
    expect(known.email).toBe("asha@example.com");
    expect(known.phone).toBe("9876543210");
    expect(known.source_of.name).toBe("PROFILE");
  });

  it("falls back to the invitation and marks the source INVITE", () => {
    const known = buildKnown({
      profile: null,
      tenant: {},
      invitation: { name: "A. Kumar", email: "invited@example.com", phone: "9111111111" },
      identity: null,
    });
    expect(known.name).toBe("A. Kumar");
    expect(known.source_of.name).toBe("INVITE");
    expect(known.has_prefill).toBe(false);
  });

  it("treats the phone as verified only when the verified number is the one on offer", () => {
    const verified = buildKnown({
      profile: { id: "p1", name: "Asha", email: "a@b.com", phone: "9876543210", mobile_verified: true },
      tenant: {}, invitation: null, identity: identity(),
    });
    expect(verified.phone_verified).toBe(true);

    const stale = buildKnown({
      profile: { id: "p1", name: "Asha", email: "a@b.com", phone: "9876543210", mobile_verified: true },
      tenant: { phone_1: "9000000000" }, invitation: null, identity: identity(),
    });
    // The profile's phone still wins, so this stays verified — the mismatch
    // case that matters is a profile with no phone at all.
    expect(stale.phone_verified).toBe(true);

    const noProfilePhone = buildKnown({
      profile: { id: "p1", name: "Asha", email: "a@b.com", phone: null, mobile_verified: true },
      tenant: { phone_1: "9000000000" }, invitation: null, identity: identity(),
    });
    expect(noProfilePhone.phone).toBe("9000000000");
    expect(noProfilePhone.phone_verified).toBe(false);
  });

  it("marks identity fields read off a tenancy as TENANCY, and the rest PROFILE", () => {
    const known = buildKnown({
      profile: { id: "p1", name: "Asha", email: "a@b.com", phone: "9876543210" },
      tenant: {}, invitation: null,
      identity: identity({
        gender: "Female",
        college_name: "NIT Warangal",
        has_profile_record: true,
        pending_backfill_fields: ["college_name"],
      }),
    });
    expect(known.source_of.gender).toBe("PROFILE");
    expect(known.source_of.college_name).toBe("TENANCY");
    expect(known.identity.gender).toBe("Female");
    expect(known.has_prefill).toBe(true);
  });

  it("does not claim a source for a field that has no value", () => {
    const known = buildKnown({
      profile: { id: "p1", name: "Asha", email: "a@b.com", phone: "9876543210" },
      tenant: {}, invitation: null, identity: identity({ has_profile_record: true }),
    });
    expect(known.source_of.gender).toBeUndefined();
    expect(known.identity.gender).toBeNull();
  });

  it("has prefill when a backfill-sourced field exists even with no profile record", () => {
    const known = buildKnown({
      profile: { id: "p1", name: "Asha", email: "a@b.com", phone: "9876543210" },
      tenant: {}, invitation: null,
      identity: identity({ gender: "Female", pending_backfill_fields: ["gender"], has_profile_record: false }),
    });
    expect(known.has_prefill).toBe(true);
  });
});
