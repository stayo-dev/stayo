import { describe, it, expect, vi } from "vitest";

/**
 * An owner's UPI ID is now the entire rent-collection mechanism, so it has to
 * be validated at the point it is written.
 *
 * Before this, `upi_id` accepted any string. That was harmless while the field
 * was decorative; with the gateway disconnected, a typo'd VPA becomes a QR that
 * fails inside the tenant's UPI app — where nobody on our side can observe it,
 * and where the tenant concludes Stayo lost their rent.
 *
 * Note `lib/services/hostel-policy-service.test.ts` exists but never runs: the
 * main vitest config excludes `lib/**\/*.test.ts` and the pure config does not
 * list it. This file lives in `tests/` so it actually executes.
 *
 * Pure: `@/lib/db` is mocked, so no client is constructed.
 */

vi.mock("@/lib/db", () => ({ prisma: {} }));

// A static import is fine here — vitest hoists `vi.mock` above it — and a
// top-level `await import` would not compile under this tsconfig's module target.
import {
  validateHostelPolicyForWrite,
  normalizeHostelPolicy,
} from "@/lib/services/hostel-policy-service";

/** A policy with the given UPI ID, everything else at defaults. */
function policyWithUpi(upi_id: string | null) {
  return normalizeHostelPolicy({ preferences_config: { payments: { upi_id } } } as any);
}

describe("UPI ID validation on hostel policy write", () => {
  it("accepts the shapes real UPI handles take", () => {
    for (const vpa of ["adithya@okhdfcbank", "9876543210@ybl", "sri.adithya-hostel@okaxis"]) {
      expect(() => validateHostelPolicyForWrite(policyWithUpi(vpa))).not.toThrow();
    }
  });

  it("allows no UPI ID at all", () => {
    // Most hostels have none set yet (0 of 6 in production at the time of
    // writing). Absence must stay valid or every unrelated settings save breaks.
    expect(() => validateHostelPolicyForWrite(policyWithUpi(null))).not.toThrow();
    expect(() => validateHostelPolicyForWrite(policyWithUpi(""))).not.toThrow();
  });

  it("rejects an email address, which is what owners actually paste", () => {
    expect(() => validateHostelPolicyForWrite(policyWithUpi("owner@gmail.com"))).toThrow(/UPI/i);
  });

  it("rejects a handle with no @, and a bare @", () => {
    expect(() => validateHostelPolicyForWrite(policyWithUpi("adithya"))).toThrow(/UPI/i);
    expect(() => validateHostelPolicyForWrite(policyWithUpi("@okhdfcbank"))).toThrow(/UPI/i);
    expect(() => validateHostelPolicyForWrite(policyWithUpi("adithya@"))).toThrow(/UPI/i);
  });

  it("rejects a pasted value carrying whitespace", () => {
    expect(() => validateHostelPolicyForWrite(policyWithUpi(" adithya@okhdfcbank"))).toThrow(/UPI/i);
    expect(() => validateHostelPolicyForWrite(policyWithUpi("adithya @okhdfcbank"))).toThrow(/UPI/i);
  });

  it("says UPI ID in the message, so the owner knows which field is wrong", () => {
    // The settings form saves many fields at once; "VALIDATION: invalid" would
    // leave the owner hunting.
    expect(() => validateHostelPolicyForWrite(policyWithUpi("nope"))).toThrow(/UPI ID/i);
  });
});
