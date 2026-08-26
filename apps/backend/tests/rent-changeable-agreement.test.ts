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
 * Which agreement a rent change may be applied to.
 *
 * `POST /api/tenants/:id/change-rent` looked for an agreement in the *current*
 * set — SIGNED / EXPIRING_SOON / AGREEMENT_EXPIRED — and 404'd with "No active
 * agreement found for this tenant" when it found none. A hostel with
 * `tenant_rules.agreement_required = false` (ADR-059) never has its tenants
 * sign, so their `Agreement` row stays **DRAFT** forever, and rent could never
 * be changed for any of them.
 *
 * The row still exists, deliberately: per [[Business-Rules]], agreement
 * signing "governs the signing ceremony only — `Agreement` rows are created
 * either way, because `contract_rent` on that record is what rent changes,
 * obligation generation, renewals and move-out settlement key to."
 *
 * So "may this agreement's rent change?" and "is this a signed, current
 * agreement?" are two different questions, and this module answers both
 * separately rather than reusing one list for both.
 */

describe("isRentChangeableAgreementStatus", () => {
  it("allows a DRAFT agreement — the whole point of the fix", () => {
    expect(isRentChangeableAgreementStatus("DRAFT")).toBe(true);
  });

  it("allows every status that already counted as current", () => {
    for (const status of CURRENT_AGREEMENT_STATUSES) {
      expect(isRentChangeableAgreementStatus(status)).toBe(true);
    }
  });

  it("refuses a superseded agreement", () => {
    // RENEWED means a later agreement governs; repricing this one would
    // rewrite a contract that is no longer in force.
    expect(isRentChangeableAgreementStatus("RENEWED")).toBe(false);
  });

  it("refuses a terminated agreement", () => {
    expect(isRentChangeableAgreementStatus("TERMINATED")).toBe(false);
  });

  it("refuses an unrecognised status rather than defaulting open", () => {
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
