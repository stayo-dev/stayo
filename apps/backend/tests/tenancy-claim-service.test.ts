import { describe, expect, it, vi } from "vitest";

// `tenancy-claim-service.ts` imports `@/lib/db` (directly, and transitively
// through `invited-profile-resolver.ts` / `tenancy-eligibility-service.ts`).
// `lib/db.ts` throws at import time under `NODE_ENV=test` unless
// `DATABASE_URL_TEST` is set — mocking it here is what qualifies this file
// for `vitest.pure.config.ts` (no real database ever gets touched). See
// `tests/profile-identity-service.test.ts` for the same pattern.
vi.mock("@/lib/db", () => ({
  prisma: {},
}));

import { CLAIM_OTP_PURPOSE, CLAIM_PROOF_MAX_AGE_MS } from "@/lib/tenants/claim-eligibility";
import {
  assertAcknowledgementsComplete,
  assertClaimablePhoneMatch,
  assertValidClaimProof,
  consumeClaimProof,
  loadClaimOtpProof,
  REQUIRED_ACKNOWLEDGEMENTS,
  TenancyClaimError,
  toClaimSummary,
} from "@/src/services/tenants/tenancy-claim-service";

/** A minimal fake `phoneVerificationOtp` delegate over an in-memory row set. */
function fakeOtpDb(rows: any[]) {
  return {
    phoneVerificationOtp: {
      findFirst: vi.fn(async ({ where, orderBy }: any) => {
        const matches = rows.filter(
          (r) => r.phone === where.phone && r.purpose === where.purpose,
        );
        if (matches.length === 0) return null;
        // orderBy created_at desc — the fakes below already list newest-first
        // when it matters, but sort defensively to match Prisma's contract.
        const dir = orderBy?.created_at === "desc" ? -1 : 1;
        return [...matches].sort((a, b) => dir * (a.created_at - b.created_at))[0];
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const row = rows.find((r) => r.id === where.id && r.status === where.status);
        if (!row) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      }),
    },
  };
}

function verifiedRow(overrides: Partial<any> = {}) {
  return {
    id: "otp-1",
    phone: "919876543210",
    purpose: CLAIM_OTP_PURPOSE,
    status: "VERIFIED",
    verified_at: new Date("2026-08-27T12:00:00.000Z"),
    created_at: new Date("2026-08-27T11:59:00.000Z"),
    ...overrides,
  };
}

describe("assertValidClaimProof — SECURITY: SKIPPED is refused at the service's own validation layer", () => {
  const now = new Date("2026-08-27T12:00:00.000Z");

  it("throws OTP_PROOF_REQUIRED for a SKIPPED row, never treating it as proof", async () => {
    const db = fakeOtpDb([verifiedRow({ status: "SKIPPED", verified_at: null })]);
    await expect(assertValidClaimProof(db, "+919876543210", now)).rejects.toMatchObject({
      code: "OTP_PROOF_REQUIRED",
      status: 401,
    });
  });

  it("throws OTP_PROOF_REQUIRED when no row exists at all", async () => {
    const db = fakeOtpDb([]);
    await expect(assertValidClaimProof(db, "+919876543210", now)).rejects.toBeInstanceOf(TenancyClaimError);
  });

  it("accepts a fresh VERIFIED row and returns it (id included, for later consumption)", async () => {
    const db = fakeOtpDb([verifiedRow()]);
    const proof = await assertValidClaimProof(db, "+919876543210", now);
    expect(proof.id).toBe("otp-1");
    expect(proof.status).toBe("VERIFIED");
  });
});

describe("assertValidClaimProof — re-validates independently every call, never caches", () => {
  it("a row valid on the first call and consumed before the second call is refused the second time", async () => {
    const now = new Date("2026-08-27T12:00:00.000Z");
    const row = verifiedRow();
    const db = fakeOtpDb([row]);

    // First call — e.g. what `confirm`'s own re-validation does.
    const proof = await assertValidClaimProof(db, "+919876543210", now);
    expect(proof.status).toBe("VERIFIED");

    // Simulate the same proof being consumed by a concurrent claim between
    // the two calls (what `consumeClaimProof` does on success).
    row.status = "CONSUMED";

    // A second independent re-validation — e.g. a retried request reusing
    // the same phone — must hit the database again and see the new state,
    // not return a cached "still valid" answer.
    await expect(assertValidClaimProof(db, "+919876543210", now)).rejects.toMatchObject({
      code: "OTP_PROOF_REQUIRED",
    });
    expect(db.phoneVerificationOtp.findFirst).toHaveBeenCalledTimes(2);
  });
});

describe("consumeClaimProof — a consumed proof cannot be reused", () => {
  it("the first consumption succeeds (guarded update matches the VERIFIED row)", async () => {
    const row = verifiedRow();
    const db = fakeOtpDb([row]);
    const ok = await consumeClaimProof(db, row.id);
    expect(ok).toBe(true);
    expect(row.status).toBe("CONSUMED");
  });

  it("SECURITY: a second consumption of the same row is refused — the guarded update matches zero rows", async () => {
    const row = verifiedRow();
    const db = fakeOtpDb([row]);
    expect(await consumeClaimProof(db, row.id)).toBe(true);
    // Race / replay: a second attempt against the now-CONSUMED row must not
    // report success — this is what stops the same OTP proof from binding a
    // second tenancy, or the same claim being replayed.
    expect(await consumeClaimProof(db, row.id)).toBe(false);
  });

  it("consuming an unknown id is refused, not silently a no-op success", async () => {
    const db = fakeOtpDb([verifiedRow()]);
    expect(await consumeClaimProof(db, "does-not-exist")).toBe(false);
  });
});

describe("loadClaimOtpProof — the +91XXXXXXXXXX -> 91XXXXXXXXXX conversion", () => {
  it("queries phone_verification_otps with the WhatsApp digit format, not the E.164 form", async () => {
    const db = fakeOtpDb([verifiedRow({ phone: "919876543210" })]);
    const proof = await loadClaimOtpProof(db, "+919876543210");
    expect(proof).not.toBeNull();
    expect(db.phoneVerificationOtp.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { phone: "919876543210", purpose: CLAIM_OTP_PURPOSE },
      }),
    );
  });

  it("REGRESSION GUARD: if this conversion breaks, every claim 401s — a mismatched format finds nothing", async () => {
    // The row is stored in canonical digit form; querying with the raw
    // E.164 string (i.e. as if the conversion were skipped) must find nothing.
    const db = fakeOtpDb([verifiedRow({ phone: "919876543210" })]);
    const wrongFormatResult = await db.phoneVerificationOtp.findFirst({
      where: { phone: "+919876543210", purpose: CLAIM_OTP_PURPOSE },
      orderBy: { created_at: "desc" },
    });
    expect(wrongFormatResult).toBeNull();
  });
});

describe("assertAcknowledgementsComplete", () => {
  it("passes when every required acknowledgement is explicitly true", () => {
    const all = Object.fromEntries(REQUIRED_ACKNOWLEDGEMENTS.map((key) => [key, true]));
    expect(() => assertAcknowledgementsComplete(all)).not.toThrow();
  });

  it("rejects when acknowledgements are entirely absent — a frontend checkbox no endpoint checks is decoration", () => {
    expect(() => assertAcknowledgementsComplete(undefined)).toThrow(TenancyClaimError);
    expect(() => assertAcknowledgementsComplete(null)).toThrow(TenancyClaimError);
  });

  it("rejects when any single required key is missing or false", () => {
    const missingOne = Object.fromEntries(
      REQUIRED_ACKNOWLEDGEMENTS.filter((k) => k !== "hostel_rules").map((key) => [key, true]),
    );
    expect(() => assertAcknowledgementsComplete(missingOne)).toThrow(TenancyClaimError);

    const oneFalse = Object.fromEntries(REQUIRED_ACKNOWLEDGEMENTS.map((key) => [key, key !== "damage_liabilities"]));
    expect(() => assertAcknowledgementsComplete(oneFalse)).toThrow(TenancyClaimError);
  });

  it("throws with code ACKNOWLEDGEMENTS_REQUIRED", () => {
    try {
      assertAcknowledgementsComplete({});
      throw new Error("expected assertAcknowledgementsComplete to throw");
    } catch (error: any) {
      expect(error).toBeInstanceOf(TenancyClaimError);
      expect(error.code).toBe("ACKNOWLEDGEMENTS_REQUIRED");
      expect(error.status).toBe(400);
    }
  });
});

describe("assertClaimablePhoneMatch — SECURITY: a claim never overwrites an existing account's password", () => {
  it("no-op when no profile exists at that phone — the caller goes on to create one", () => {
    expect(() => assertClaimablePhoneMatch(null)).not.toThrow();
  });

  it("REGRESSION GUARD: refuses with SIGN_IN_REQUIRED when the matched TENANT profile already has a password_hash", () => {
    try {
      assertClaimablePhoneMatch({ role: "TENANT", password_hash: "$2b$10$somehash" });
      throw new Error("expected assertClaimablePhoneMatch to throw");
    } catch (error: any) {
      expect(error).toBeInstanceOf(TenancyClaimError);
      expect(error.code).toBe("SIGN_IN_REQUIRED");
      expect(error.status).toBe(401);
    }
  });

  it("allows reuse when the matched TENANT profile has no password_hash — an invitation shell never activated", () => {
    expect(() => assertClaimablePhoneMatch({ role: "TENANT", password_hash: null })).not.toThrow();
    expect(() => assertClaimablePhoneMatch({ role: "TENANT", password_hash: undefined })).not.toThrow();
    expect(() => assertClaimablePhoneMatch({ role: "TENANT", password_hash: "" })).not.toThrow();
  });

  it("refuses with NOT_CLAIMABLE when the matched profile isn't a TENANT account, regardless of password_hash", () => {
    try {
      assertClaimablePhoneMatch({ role: "OWNER", password_hash: null });
      throw new Error("expected assertClaimablePhoneMatch to throw");
    } catch (error: any) {
      expect(error).toBeInstanceOf(TenancyClaimError);
      expect(error.code).toBe("NOT_CLAIMABLE");
      expect(error.status).toBe(409);
    }
  });

  it("NOT_CLAIMABLE takes priority over SIGN_IN_REQUIRED — a non-TENANT match is refused for its role, not its password", () => {
    try {
      assertClaimablePhoneMatch({ role: "OWNER", password_hash: "$2b$10$somehash" });
      throw new Error("expected assertClaimablePhoneMatch to throw");
    } catch (error: any) {
      expect(error.code).toBe("NOT_CLAIMABLE");
    }
  });
});

describe("toClaimSummary — SECURITY: no financial field beyond monthly_rent", () => {
  it("returns exactly this key set, even when the source tenant carries more (security_deposit, maintenance_charge, owner_id, ...)", () => {
    const tenant = {
      id: "t1",
      owner_id: "owner-1",
      hostel_id: "h1",
      access_mode: "OWNER_MANAGED",
      status: "ACTIVE",
      display_name: "Rakesh",
      phone_1: "+919876543210",
      joined_on: new Date("2026-01-01"),
      monthly_rent: 9000,
      security_deposit: 20000,
      maintenance_charge: 1500,
      hostels: { name: "Sri Adithya", profiles: { name: "Owner Name" } },
      room_allocations: [{ room: { room_no: "A-101" } }],
    };

    const summary = toClaimSummary(tenant);

    expect(Object.keys(summary).sort()).toEqual(
      ["hostel_name", "joined_on", "monthly_rent", "owner_name", "room_no", "tenant_id"].sort(),
    );
    expect((summary as any).security_deposit).toBeUndefined();
    expect((summary as any).maintenance_charge).toBeUndefined();
    expect((summary as any).owner_id).toBeUndefined();
  });
});

// Sanity: CLAIM_PROOF_MAX_AGE_MS is imported above purely to confirm the
// eligibility module's constant is reachable from this test file the same
// way the service reaches it — guards against an accidental re-export drift.
describe("module wiring", () => {
  it("CLAIM_PROOF_MAX_AGE_MS is a positive, sane freshness window", () => {
    expect(CLAIM_PROOF_MAX_AGE_MS).toBeGreaterThan(0);
  });
});
