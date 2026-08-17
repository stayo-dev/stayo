import { describe, it, expect } from "vitest";
import {
  canStart, canMarkPaid, canMarkFailed, validatePayout, ITEM_STATUSES,
} from "@/src/services/settlements/settlement-transitions";

describe("canStart", () => {
  it("moves a pending item into processing", () => {
    expect(canStart({ status: "PENDING" }).ok).toBe(true);
  });

  it("refuses anything already in flight or finished", () => {
    for (const status of ["PROCESSING", "PAID", "FAILED", "CANCELLED"]) {
      expect(canStart({ status }).ok).toBe(false);
    }
  });
});

describe("canMarkPaid", () => {
  /**
   * The design's two-step (start → confirm) exists so nobody pays from a list
   * view by mis-tap. Allowing PENDING → PAID directly would defeat it.
   */
  it("only allows a payout from PROCESSING", () => {
    expect(canMarkPaid({ status: "PROCESSING" }).ok).toBe(true);
    expect(canMarkPaid({ status: "PENDING" }).ok).toBe(false);
  });

  it("refuses to pay an item twice — PAID is terminal", () => {
    const result = canMarkPaid({ status: "PAID" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/already been paid/i);
  });

  it("allows retrying a failed payout", () => {
    // A failed bank transfer is a real situation; the money never moved.
    expect(canMarkPaid({ status: "FAILED" }).ok).toBe(true);
  });
});

describe("canMarkFailed", () => {
  it("only from processing", () => {
    expect(canMarkFailed({ status: "PROCESSING" }).ok).toBe(true);
    expect(canMarkFailed({ status: "PENDING" }).ok).toBe(false);
  });

  it("never un-pays a completed payout", () => {
    expect(canMarkFailed({ status: "PAID" }).ok).toBe(false);
  });
});

describe("validatePayout", () => {
  it("accepts a real method and reference", () => {
    expect(validatePayout({ method: "BANK_TRANSFER", reference: "KKBKN61120038841" }).ok).toBe(true);
  });

  /**
   * A payout with no reference cannot be reconciled against a bank statement
   * later, which is the entire reason for recording it.
   */
  it("refuses a payout with no reference", () => {
    for (const reference of ["", "   ", undefined]) {
      const result = validatePayout({ method: "UPI", reference: reference as string });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toMatch(/reference|UTR/i);
    }
  });

  it("refuses an unknown payment method rather than storing free text", () => {
    expect(validatePayout({ method: "CARRIER_PIGEON", reference: "X1" }).ok).toBe(false);
  });

  it("accepts every method an admin can actually use", () => {
    for (const method of ["BANK_TRANSFER", "UPI", "IMPS", "NEFT", "RTGS"]) {
      expect(validatePayout({ method, reference: "REF123" }).ok).toBe(true);
    }
  });

  it("trims a reference, so trailing spaces do not become part of the UTR", () => {
    const result = validatePayout({ method: "UPI", reference: "  utr-9 " });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.reference).toBe("utr-9");
  });
});

describe("ITEM_STATUSES", () => {
  it("has no status the UI could receive and fail to render", () => {
    expect([...ITEM_STATUSES].sort()).toEqual(
      ["CANCELLED", "FAILED", "PAID", "PENDING", "PROCESSING"],
    );
  });
});
