import { describe, expect, it } from "vitest";
import {
  CURRENT_AGREEMENT_STATUSES,
  RENT_CHANGEABLE_AGREEMENT_STATUSES,
  currentAgreementWhere,
  isCurrentAgreementStatus,
  isRentChangeableAgreementStatus,
  rentChangeableAgreementWhere,
} from "@/src/services/tenants/agreement-status";

/**
 * Which agreement's `contract_rent` follows a rent change.
 *
 * Rent is anchored to `tenants.monthly_rent`; an agreement is an optional
 * snapshot (ADR-059 lets an owner switch signing off entirely, and then none
 * is ever signed). This set decides only which snapshot is live enough to keep
 * in step when the tenant's rent moves — never whether the change is allowed.
 *
 * DRAFT counts, because a hostel that doesn't require signing leaves its
 * tenants on a DRAFT row for the whole tenancy while renewals and settlement
 * would still read from it. RENEWED and TERMINATED don't: a later agreement
 * governs, or none does.
 *
 * So "should this agreement's rent follow?" and "is this a signed, current
 * agreement?" are two different questions, and this module answers both
 * separately rather than reusing one list for both.
 */

describe("isRentChangeableAgreementStatus", () => {
  it("includes a DRAFT agreement — a never-signed row still drives renewals", () => {
    expect(isRentChangeableAgreementStatus("DRAFT")).toBe(true);
  });

  it("includes every status that already counted as current", () => {
    for (const status of CURRENT_AGREEMENT_STATUSES) {
      expect(isRentChangeableAgreementStatus(status)).toBe(true);
    }
  });

  it("excludes a superseded agreement", () => {
    // RENEWED means a later agreement governs; repricing this one would
    // rewrite a contract that is no longer in force.
    expect(isRentChangeableAgreementStatus("RENEWED")).toBe(false);
  });

  it("excludes a terminated agreement", () => {
    expect(isRentChangeableAgreementStatus("TERMINATED")).toBe(false);
  });

  it("excludes an unrecognised status rather than defaulting open", () => {
    expect(isRentChangeableAgreementStatus("SOMETHING_NEW")).toBe(false);
    expect(isRentChangeableAgreementStatus(null)).toBe(false);
    expect(isRentChangeableAgreementStatus(undefined)).toBe(false);
    expect(isRentChangeableAgreementStatus("")).toBe(false);
  });

  it("is case-insensitive, like the other status helpers", () => {
    expect(isRentChangeableAgreementStatus("draft")).toBe(true);
  });
});

describe("rentChangeableAgreementWhere", () => {
  it("builds a Prisma filter over exactly the rent-changeable statuses", () => {
    expect(rentChangeableAgreementWhere()).toEqual({
      in: [...RENT_CHANGEABLE_AGREEMENT_STATUSES],
    });
  });

  it("is strictly wider than the current-agreement filter, by DRAFT alone", () => {
    const changeable = new Set<string>(RENT_CHANGEABLE_AGREEMENT_STATUSES);
    for (const status of CURRENT_AGREEMENT_STATUSES) {
      expect(changeable.has(status)).toBe(true);
    }
    expect(changeable.size).toBe(CURRENT_AGREEMENT_STATUSES.length + 1);
    expect(changeable.has("DRAFT")).toBe(true);
  });
});

describe("the display meaning of 'current' is unchanged", () => {
  /**
   * Guard, not decoration. `currentAgreementWhere()` drives `has_active_agreement`
   * on the owner overview, the Documents tab's agreement, and the renewal
   * queue. Widening *that* to include DRAFT would tell owners a never-signed
   * agreement is an "Active Contract". Only the rent-change path widens.
   */
  it("still refuses to call a DRAFT agreement current", () => {
    expect(isCurrentAgreementStatus("DRAFT")).toBe(false);
    expect((currentAgreementWhere() as { in: string[] }).in).not.toContain("DRAFT");
  });
});
