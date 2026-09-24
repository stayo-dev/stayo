import { describe, it, expect } from "vitest";
import {
  normaliseUtr,
  isPlausibleUtr,
  validateClaimSubmission,
  nextClaimState,
  amountMismatchNote,
  CLAIM_STATES,
} from "@/src/services/payments/upi/tenant-payment-claim-rules";

/**
 * What a tenant's payment claim may say, and how it may move.
 *
 * A claim is evidence, never money — the ledger changes only when the owner
 * confirms. These rules are the entire gate between "a stranger typed
 * something into a public page" and "rent was received", so they live in a
 * pure module and are pinned here rather than being spread across a route.
 *
 * The page that submits a claim needs no login: its token arrives in a
 * WhatsApp button. Anyone holding a forwarded link can post to it.
 */

describe("normaliseUtr", () => {
  it("strips the spacing and case banks and apps add", () => {
    expect(normaliseUtr(" 1234 5678 9012 ")).toBe("123456789012");
    expect(normaliseUtr("abc123def456")).toBe("ABC123DEF456");
  });

  it("removes the labels people paste along with the number", () => {
    // Copied straight out of a UPI app's receipt screen.
    expect(normaliseUtr("UTR: 123456789012")).toBe("123456789012");
    expect(normaliseUtr("Ref no. 123456789012")).toBe("123456789012");
  });

  it("survives an empty or missing value", () => {
    expect(normaliseUtr("")).toBe("");
    expect(normaliseUtr(null as unknown as string)).toBe("");
  });
});

describe("isPlausibleUtr", () => {
  it("accepts a 12-digit UPI reference", () => {
    expect(isPlausibleUtr("123456789012")).toBe(true);
  });

  it("accepts the longer alphanumeric references some banks issue", () => {
    // Not every rail returns exactly 12 digits, and rejecting a real reference
    // is worse than accepting an odd one: the owner checks it against their
    // statement either way.
    expect(isPlausibleUtr("SBIN0012345678")).toBe(true);
  });

  it("rejects something far too short to be a reference", () => {
    expect(isPlausibleUtr("123")).toBe(false);
    expect(isPlausibleUtr("")).toBe(false);
  });

  it("rejects free text, which is what a confused tenant types", () => {
    expect(isPlausibleUtr("I paid by phonepe")).toBe(false);
    expect(isPlausibleUtr("paid")).toBe(false);
  });
});

describe("validateClaimSubmission", () => {
  const ok = { utr: "123456789012", claimedAmountPaise: 850000 };

  it("accepts a well-formed claim", () => {
    expect(validateClaimSubmission(ok).error).toBeNull();
  });

  it("requires a reference, because it is the only checkable part", () => {
    // A screenshot cannot be matched against a bank statement. This can.
    expect(validateClaimSubmission({ ...ok, utr: "" }).error).toMatch(/reference/i);
    expect(validateClaimSubmission({ ...ok, utr: "nope" }).error).toMatch(/reference/i);
  });

  it("requires a positive amount", () => {
    expect(validateClaimSubmission({ ...ok, claimedAmountPaise: 0 }).error).toMatch(/amount/i);
    expect(validateClaimSubmission({ ...ok, claimedAmountPaise: -1 }).error).toMatch(/amount/i);
  });

  it("refuses an implausibly large amount rather than storing it", () => {
    // A fat-fingered extra zero on a public, unauthenticated form should not
    // land in the owner's dashboard as a ₹85,00,000 claim.
    expect(validateClaimSubmission({ ...ok, claimedAmountPaise: 100_000_00_000 }).error)
      .toMatch(/amount/i);
  });

  it("returns the normalised UTR so storage and duplicate checks agree", () => {
    const result = validateClaimSubmission({ ...ok, utr: " 1234 5678 9012 " });
    expect(result.error).toBeNull();
    expect(result.utr).toBe("123456789012");
  });
});

describe("nextClaimState", () => {
  it("lets an owner confirm or reject a pending claim", () => {
    expect(nextClaimState("PENDING", "CONFIRM")).toBe("CONFIRMED");
    expect(nextClaimState("PENDING", "REJECT")).toBe("REJECTED");
  });

  it("refuses to confirm the same claim twice", () => {
    // Double-confirming is double-crediting rent. The obligation is
    // audit-first and has no edit endpoint, so this must be stopped here.
    expect(() => nextClaimState("CONFIRMED", "CONFIRM")).toThrow(/already/i);
  });

  it("refuses to act on a claim the owner already rejected", () => {
    expect(() => nextClaimState("REJECTED", "CONFIRM")).toThrow(/already/i);
    expect(() => nextClaimState("REJECTED", "REJECT")).toThrow(/already/i);
  });

  it("refuses to un-confirm, because reversal is not a claim operation", () => {
    // Obligations are immutable; a wrongly confirmed payment is corrected
    // through the existing correction path, never by rewinding the claim.
    expect(() => nextClaimState("CONFIRMED", "REJECT")).toThrow(/already/i);
  });

  it("knows only the three states the CHECK constraint allows", () => {
    expect(CLAIM_STATES).toEqual(["PENDING", "CONFIRMED", "REJECTED"]);
  });
});

describe("amountMismatchNote", () => {
  it("says nothing when the tenant paid what was asked", () => {
    expect(amountMismatchNote(850000, 850000)).toBeNull();
  });

  it("flags a short payment, so the owner is not surprised later", () => {
    // ₹8,500 asked, ₹5,000 paid — the note states the SHORTFALL (₹3,500),
    // which is the number the owner still has to chase.
    const note = amountMismatchNote(850000, 500000);
    expect(note).toMatch(/less/i);
    expect(note).toContain("₹3,500");
  });

  it("flags an overpayment too", () => {
    expect(amountMismatchNote(850000, 900000)).toMatch(/more/i);
  });

  it("treats a mismatch as ordinary, not as an accusation", () => {
    // Most UPI apps let the payer edit the amount, so this is routine. The
    // wording must not imply the tenant did something wrong.
    const note = amountMismatchNote(850000, 500000)!;
    expect(note).not.toMatch(/wrong|invalid|fraud|error|suspicious/i);
  });
});
