import { describe, it, expect } from "vitest";
import { decideDelivery, consumesQuota, DEFAULT_FREE_QUOTA } from "@/src/services/marketing/partner-quota";
import { canMessagePartner } from "@/src/services/marketing/partner-consent";
import {
  nextDeliveryState,
  isWithheld,
  isDeliveryState,
} from "@/src/services/marketing/partner-delivery-state";
import { inviteRoleLabel } from "@/src/services/managers/manager-invite-labels";

describe("free-enquiry gate", () => {
  it("delivers the first three enquiries and numbers them for the message", () => {
    expect(decideDelivery({ deliveredCount: 0, freeQuota: 3 })).toEqual({ action: "DELIVER", sequence: 1 });
    expect(decideDelivery({ deliveredCount: 1, freeQuota: 3 })).toEqual({ action: "DELIVER", sequence: 2 });
    expect(decideDelivery({ deliveredCount: 2, freeQuota: 3 })).toEqual({ action: "DELIVER", sequence: 3 });
  });

  it("holds the fourth", () => {
    expect(decideDelivery({ deliveredCount: 3, freeQuota: 3 })).toEqual({ action: "HOLD", delivered: 3 });
    expect(decideDelivery({ deliveredCount: 9, freeQuota: 3 })).toEqual({ action: "HOLD", delivered: 9 });
  });

  /**
   * Only a confirmed delivery consumes quota. Partner templates carry a
   * 12-hour Meta validity period, so an undelivered message is dropped and
   * never seen — counting attempts would paywall an owner whose phone was
   * off, with a message claiming they had already had three enquiries.
   */
  it("counts confirmed deliveries only", () => {
    expect(consumesQuota("SENT")).toBe(true);
    for (const state of ["PENDING", "HELD", "RELEASED", "FAILED", "EXPIRED"]) {
      expect(consumesQuota(state)).toBe(false);
    }
  });

  // Over-delivering a free lead costs one lead; under-delivering costs the
  // owner. The gate is built to fail in the first direction.
  it("errs toward generosity when sends are still in flight", () => {
    // Three enquiries accepted but none yet confirmed delivered.
    expect(decideDelivery({ deliveredCount: 0, freeQuota: 3 }).action).toBe("DELIVER");
  });

  it("treats a zero quota as a real setting and holds everything", () => {
    expect(decideDelivery({ deliveredCount: 0, freeQuota: 0 })).toEqual({ action: "HOLD", delivered: 0 });
  });

  // A bad row must never silently paywall a partner, so a missing or
  // nonsensical quota falls back to the default rather than to zero.
  it("falls back to the default quota rather than to zero", () => {
    expect(decideDelivery({ deliveredCount: 0 })).toEqual({ action: "DELIVER", sequence: 1 });
    expect(decideDelivery({ deliveredCount: 0, freeQuota: Number.NaN }).action).toBe("DELIVER");
    expect(decideDelivery({ deliveredCount: DEFAULT_FREE_QUOTA }).action).toBe("HOLD");
  });

  it("ignores a negative delivered count", () => {
    expect(decideDelivery({ deliveredCount: -4, freeQuota: 3 })).toEqual({ action: "DELIVER", sequence: 1 });
  });
});

describe("partner messaging consent", () => {
  const consented = { phone: "+919876543210", consent_at: new Date(), opted_out_at: null };

  it("allows a partner with recorded consent", () => {
    expect(canMessagePartner(consented)).toEqual({ ok: true });
  });

  /**
   * The rule platform-listing-leads.ts was written to protect: a listing's
   * contact number belongs to the business, not to someone who agreed to
   * hear from us. Consent is checked on every send, not assumed at creation.
   */
  it("refuses a partner with no recorded consent", () => {
    const guard = canMessagePartner({ ...consented, consent_at: null });
    expect(guard.ok).toBe(false);
    expect(guard.ok === false && guard.reason).toMatch(/consent/i);
  });

  it("refuses a partner who opted out", () => {
    const guard = canMessagePartner({ ...consented, opted_out_at: new Date() });
    expect(guard.ok).toBe(false);
    expect(guard.ok === false && guard.reason).toMatch(/opted out/i);
  });

  it("refuses a partner with no phone number", () => {
    expect(canMessagePartner({ ...consented, phone: "   " }).ok).toBe(false);
  });

  it("refuses a missing partner rather than throwing", () => {
    expect(canMessagePartner(null).ok).toBe(false);
    expect(canMessagePartner(undefined).ok).toBe(false);
  });
});

describe("delivery state machine", () => {
  it("confirms a pending delivery on Meta's delivered webhook", () => {
    expect(nextDeliveryState("PENDING", "delivered")).toBe("SENT");
  });

  it("records a failed or expired send without consuming quota", () => {
    expect(nextDeliveryState("PENDING", "failed")).toBe("FAILED");
    expect(nextDeliveryState("PENDING", "expired")).toBe("EXPIRED");
    expect(consumesQuota("FAILED")).toBe(false);
    expect(consumesQuota("EXPIRED")).toBe(false);
  });

  /**
   * Meta redelivers status webhooks. A second `delivered` must not
   * double-count against the free quota, so the transition returns null and
   * the caller skips the write entirely.
   */
  it("is idempotent under a redelivered webhook", () => {
    expect(nextDeliveryState("SENT", "delivered")).toBeNull();
    expect(nextDeliveryState("RELEASED", "delivered")).toBeNull();
    expect(nextDeliveryState("FAILED", "delivered")).toBeNull();
  });

  it("releases a held enquiry only on a claim", () => {
    expect(nextDeliveryState("HELD", "released")).toBe("RELEASED");
    // The locked message's own delivery statuses change nothing.
    expect(nextDeliveryState("HELD", "delivered")).toBeNull();
    expect(nextDeliveryState("HELD", "failed")).toBeNull();
  });

  it("ignores an event against an unknown state", () => {
    expect(nextDeliveryState("BANANA", "delivered")).toBeNull();
  });

  // The 12-hour student fallback keys off exactly this predicate: a withheld
  // enquiry means a student is waiting on us, not on the owner.
  it("knows which state leaves a student waiting", () => {
    expect(isWithheld("HELD")).toBe(true);
    for (const state of ["PENDING", "SENT", "RELEASED", "FAILED", "EXPIRED"]) {
      expect(isWithheld(state)).toBe(false);
    }
  });

  it("validates state strings", () => {
    expect(isDeliveryState("SENT")).toBe(true);
    expect(isDeliveryState("sent")).toBe(false);
    expect(isDeliveryState(null)).toBe(false);
  });
});

describe("invite role label", () => {
  it("names the role a person was invited into", () => {
    expect(inviteRoleLabel("MANAGER")).toBe("Manager");
    expect(inviteRoleLabel("ADMIN")).toBe("Admin");
  });

  // Never echo an unrecognised value into a template the recipient reads.
  it("falls back to a neutral phrase", () => {
    expect(inviteRoleLabel("VERIFICATION")).toBe("a team member");
    expect(inviteRoleLabel(undefined)).toBe("a team member");
  });
});
