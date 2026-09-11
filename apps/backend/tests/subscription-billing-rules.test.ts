import { describe, expect, it } from "vitest";
import {
  FOUNDING_MAX_OWNERS,
  FOUNDING_PLAN_CODE,
  canReviewPayment,
  canTransition,
  classifyPlanChange,
  computeBillingPeriod,
  computeUpgradeProration,
  daysBetween,
  roundHalfUp,
  toDateOnly,
  validatePaymentSubmission,
  validateRejection,
} from "@/src/services/platform-billing/subscription-rules";

describe("subscription state transitions", () => {
  it("a new owner starts in PENDING_PAYMENT and can only reach ACTIVE / PAUSED / CANCELLED", () => {
    expect(canTransition("PENDING_PAYMENT", "ACTIVE").ok).toBe(true);
    expect(canTransition("PENDING_PAYMENT", "PAUSED").ok).toBe(true);
    expect(canTransition("PENDING_PAYMENT", "CANCELLED").ok).toBe(true);
  });

  it("NOTHING transitions INTO TRIAL — Stayo has no trial period", () => {
    for (const from of ["PENDING_PAYMENT", "ACTIVE", "PAUSED", "EXPIRED", "CANCELLED"] as const) {
      expect(canTransition(from, "TRIAL").ok).toBe(false);
    }
  });

  it("a hypothetical legacy TRIAL row may still exit (enum kept for schema safety)", () => {
    expect(canTransition("TRIAL", "PENDING_PAYMENT").ok).toBe(true);
    expect(canTransition("TRIAL", "ACTIVE").ok).toBe(true);
    expect(canTransition("TRIAL", "PAUSED").ok).toBe(false);
  });

  it("allows ACTIVE → ACTIVE (renewal / upgrade in place)", () => {
    expect(canTransition("ACTIVE", "ACTIVE").ok).toBe(true);
  });

  it("refuses to move a CANCELLED subscription anywhere", () => {
    expect(canTransition("CANCELLED", "ACTIVE").ok).toBe(false);
    expect(canTransition("CANCELLED", "TRIAL").ok).toBe(false);
  });

  it("rejects unknown statuses instead of assuming they are safe", () => {
    expect(canTransition("NONSENSE" as any, "ACTIVE").ok).toBe(false);
    expect(canTransition("ACTIVE", "NONSENSE" as any).ok).toBe(false);
  });
});

describe("payment review guards (mirrors owner-document review)", () => {
  it("a SUBMITTED or UNDER_REVIEW payment is reviewable", () => {
    expect(canReviewPayment("SUBMITTED").ok).toBe(true);
    expect(canReviewPayment("UNDER_REVIEW").ok).toBe(true);
  });

  it("an already-decided payment cannot be reviewed again", () => {
    const approved = canReviewPayment("APPROVED");
    const rejected = canReviewPayment("REJECTED");
    expect(approved.ok).toBe(false);
    expect(rejected.ok).toBe(false);
    if (!approved.ok) expect(approved.reason).toMatch(/already approved/i);
    if (!rejected.ok) expect(rejected.reason).toMatch(/already rejected/i);
  });

  it("rejection requires a non-empty reason", () => {
    expect(validateRejection("").ok).toBe(false);
    expect(validateRejection("   ").ok).toBe(false);
    expect(validateRejection(null).ok).toBe(false);
    expect(validateRejection("blurry screenshot").ok).toBe(true);
  });
});

describe("payment submission validation", () => {
  const base = { amount_paise: 149900, payment_method: "CASH", currency: "INR" };

  it("accepts a valid CASH submission with no reference/proof", () => {
    expect(validatePaymentSubmission(base).ok).toBe(true);
  });

  it("requires a positive whole number of paise", () => {
    expect(validatePaymentSubmission({ ...base, amount_paise: 0 }).ok).toBe(false);
    expect(validatePaymentSubmission({ ...base, amount_paise: -5 }).ok).toBe(false);
    expect(validatePaymentSubmission({ ...base, amount_paise: 12.5 }).ok).toBe(false);
    expect(validatePaymentSubmission({ ...base, amount_paise: "149900" }).ok).toBe(true); // numeric string coerces
  });

  it("rejects an unknown payment method", () => {
    expect(validatePaymentSubmission({ ...base, payment_method: "PAYPAL" }).ok).toBe(false);
  });

  it("rejects GATEWAY — Phase 2 has no gateway (enum value is future-only)", () => {
    const r = validatePaymentSubmission({ ...base, payment_method: "GATEWAY" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/not available yet/i);
  });

  it("UPI_MANUAL requires both a transaction reference and a proof file", () => {
    expect(validatePaymentSubmission({ ...base, payment_method: "UPI_MANUAL" }).ok).toBe(false);
    expect(
      validatePaymentSubmission({ ...base, payment_method: "UPI_MANUAL", transaction_reference: "UTR123" }).ok,
    ).toBe(false);
    expect(
      validatePaymentSubmission({
        ...base,
        payment_method: "UPI_MANUAL",
        transaction_reference: "UTR123",
        proof_file_url: "https://img/x.png",
      }).ok,
    ).toBe(true);
  });

  it("rejects a non-INR currency", () => {
    expect(validatePaymentSubmission({ ...base, currency: "USD" }).ok).toBe(false);
  });
});

describe("plan change classification", () => {
  const common = { currentPlanId: "growth", selectedPlanId: "growth" };

  it("the first payment (from PENDING_PAYMENT) is a NEW activation", () => {
    expect(
      classifyPlanChange({ ...common, currentStatus: "PENDING_PAYMENT", currentPlanPricePaise: null, selectedPlanPricePaise: 249900 }),
    ).toBe("NEW");
    // a re-activation payment from PAUSED is also NEW
    expect(
      classifyPlanChange({ ...common, currentStatus: "PAUSED", currentPlanPricePaise: null, selectedPlanPricePaise: 249900 }),
    ).toBe("NEW");
  });

  it("same plan while ACTIVE is a RENEWAL", () => {
    expect(
      classifyPlanChange({ ...common, currentStatus: "ACTIVE", currentPlanPricePaise: 249900, selectedPlanPricePaise: 249900 }),
    ).toBe("RENEWAL");
  });

  it("a pricier plan while ACTIVE is an UPGRADE", () => {
    expect(
      classifyPlanChange({
        currentStatus: "ACTIVE",
        currentPlanId: "starter",
        selectedPlanId: "growth",
        currentPlanPricePaise: 149900,
        selectedPlanPricePaise: 249900,
      }),
    ).toBe("UPGRADE");
  });

  it("a cheaper plan while ACTIVE is a DOWNGRADE", () => {
    expect(
      classifyPlanChange({
        currentStatus: "ACTIVE",
        currentPlanId: "growth",
        selectedPlanId: "starter",
        currentPlanPricePaise: 249900,
        selectedPlanPricePaise: 149900,
      }),
    ).toBe("DOWNGRADE");
  });
});

describe("upgrade proration (ADR-172 §7)", () => {
  it("(new - old) × days_remaining / days_in_period, worked example", () => {
    // Starter ₹1,499 → Growth ₹2,499 (diff ₹1,000 = 100000 paise), 30-day period, 12 days left.
    // 100000 × 12 / 30 = 40000 paise = ₹400.00
    expect(
      computeUpgradeProration({ oldPricePaise: 149900, newPricePaise: 249900, daysRemaining: 12, daysInPeriod: 30 }),
    ).toBe(40000);
  });

  it("full period remaining → the full price difference", () => {
    expect(
      computeUpgradeProration({ oldPricePaise: 149900, newPricePaise: 249900, daysRemaining: 30, daysInPeriod: 30 }),
    ).toBe(100000);
  });

  it("no days remaining → zero", () => {
    expect(
      computeUpgradeProration({ oldPricePaise: 149900, newPricePaise: 249900, daysRemaining: 0, daysInPeriod: 30 }),
    ).toBe(0);
  });

  it("rounds the final result once, half-up", () => {
    // diff 100000, 1 day of 3 → 33333.33 → 33333
    expect(
      computeUpgradeProration({ oldPricePaise: 0, newPricePaise: 100000, daysRemaining: 1, daysInPeriod: 3 }),
    ).toBe(33333);
    // diff 100000, 1 day of 8 → 12500.0 exactly
    expect(
      computeUpgradeProration({ oldPricePaise: 0, newPricePaise: 100000, daysRemaining: 1, daysInPeriod: 8 }),
    ).toBe(12500);
    // a genuine .5 rounds up
    expect(roundHalfUp(12500.5)).toBe(12501);
    expect(roundHalfUp(0.5)).toBe(1);
    expect(roundHalfUp(-0.5)).toBe(-1);
  });

  it("clamps days_remaining to the period and never goes negative", () => {
    expect(
      computeUpgradeProration({ oldPricePaise: 100000, newPricePaise: 249900, daysRemaining: 999, daysInPeriod: 30 }),
    ).toBe(149900);
  });
});

describe("billing period maths", () => {
  it("computeBillingPeriod adds one month and anchors next renewal to the end", () => {
    const p = computeBillingPeriod(new Date("2026-09-10T00:00:00Z"));
    expect(p.start.toISOString().slice(0, 10)).toBe("2026-09-10");
    expect(p.end.toISOString().slice(0, 10)).toBe("2026-10-10");
    expect(p.nextRenewal.toISOString().slice(0, 10)).toBe("2026-10-10");
  });

  it("clamps month-length overflow (Jan 31 + 1mo → Feb 28)", () => {
    const p = computeBillingPeriod(new Date("2026-01-31T00:00:00Z"));
    expect(p.end.toISOString().slice(0, 10)).toBe("2026-02-28");
  });

  it("daysBetween is whole calendar days, never negative", () => {
    expect(daysBetween(new Date("2026-09-01"), new Date("2026-09-30"))).toBe(29);
    expect(daysBetween(new Date("2026-09-30"), new Date("2026-09-01"))).toBe(0);
    expect(daysBetween(toDateOnly(new Date("2026-09-10T23:00:00Z")), new Date("2026-09-11T01:00:00Z"))).toBe(1);
  });
});

describe("FOUNDING constants", () => {
  it("is a hard cap of 10 owners", () => {
    expect(FOUNDING_MAX_OWNERS).toBe(10);
    expect(FOUNDING_PLAN_CODE).toBe("FOUNDING");
  });
});
