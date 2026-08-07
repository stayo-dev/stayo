import { describe, it, expect } from "vitest";
import {
  canReviewDocument,
  validateReview,
  isReviewDecision,
  isOwnerKycComplete,
  describeKycGap,
} from "@/src/services/owner-documents/document-review-guards";

describe("canReviewDocument", () => {
  it("allows reviewing a pending document", () => {
    expect(canReviewDocument("PENDING").ok).toBe(true);
  });

  // Re-reviewing would silently overwrite an earlier admin's decision with no
  // record it happened. Reversing means the owner re-uploads.
  it("refuses to re-review a document that was already decided", () => {
    expect(canReviewDocument("VERIFIED").ok).toBe(false);
    expect(canReviewDocument("REJECTED").ok).toBe(false);
  });

  it("explains what to do instead of just refusing", () => {
    const rejected = canReviewDocument("REJECTED");
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.reason).toMatch(/upload a new one/i);
  });

  it("refuses an unrecognised status rather than assuming it is safe", () => {
    expect(canReviewDocument("").ok).toBe(false);
    expect(canReviewDocument("SOMETHING").ok).toBe(false);
  });
});

describe("validateReview", () => {
  // A rejection with no reason just makes the owner upload the same file
  // again, wasting their time and the reviewer's.
  it("requires a reason when rejecting", () => {
    expect(validateReview("REJECTED", "").ok).toBe(false);
    expect(validateReview("REJECTED", "   ").ok).toBe(false);
    expect(validateReview("REJECTED", null).ok).toBe(false);
  });

  it("accepts a rejection that explains itself", () => {
    expect(validateReview("REJECTED", "The photo is too blurry to read.").ok).toBe(true);
  });

  it("does not require a note to approve", () => {
    expect(validateReview("VERIFIED", null).ok).toBe(true);
  });
});

describe("isReviewDecision", () => {
  it("accepts only the two real decisions, case-insensitively", () => {
    expect(isReviewDecision("VERIFIED")).toBe(true);
    expect(isReviewDecision("rejected")).toBe(true);
    expect(isReviewDecision("PENDING")).toBe(false);
    expect(isReviewDecision("")).toBe(false);
    expect(isReviewDecision(undefined)).toBe(false);
  });
});

describe("isOwnerKycComplete", () => {
  const verified = (t: string) => ({ doc_type: t, status: "VERIFIED" });

  it("needs both Aadhaar and PAN verified", () => {
    expect(isOwnerKycComplete([verified("AADHAAR"), verified("PAN")])).toBe(true);
    expect(isOwnerKycComplete([verified("AADHAAR")])).toBe(false);
    expect(isOwnerKycComplete([])).toBe(false);
  });

  it("does not count an uploaded-but-unreviewed document", () => {
    expect(
      isOwnerKycComplete([{ doc_type: "AADHAAR", status: "PENDING" }, verified("PAN")]),
    ).toBe(false);
  });

  it("does not count a rejected document", () => {
    expect(
      isOwnerKycComplete([{ doc_type: "AADHAAR", status: "REJECTED" }, verified("PAN")]),
    ).toBe(false);
  });

  // A profile photo helps tenants trust a listing but is not an identity
  // document — gating go-live on it would block owners for the wrong reason.
  it("ignores the profile photo entirely", () => {
    expect(isOwnerKycComplete([verified("AADHAAR"), verified("PAN")])).toBe(true);
    expect(
      isOwnerKycComplete([verified("AADHAAR"), verified("PAN"), { doc_type: "PHOTO", status: "REJECTED" }]),
    ).toBe(true);
  });
});

describe("describeKycGap", () => {
  it("says nothing when both documents are verified", () => {
    expect(
      describeKycGap([
        { doc_type: "AADHAAR", status: "VERIFIED" },
        { doc_type: "PAN", status: "VERIFIED" },
      ]),
    ).toBeNull();
  });

  it("names what has not been uploaded", () => {
    expect(describeKycGap([])).toMatch(/AADHAAR and PAN/);
    expect(describeKycGap([{ doc_type: "AADHAAR", status: "VERIFIED" }])).toMatch(/PAN/);
  });

  // A rejection is more urgent than a gap: the owner thinks they are done.
  it("leads with a rejection over a missing upload", () => {
    const gap = describeKycGap([{ doc_type: "AADHAAR", status: "REJECTED" }]);
    expect(gap).toMatch(/rejected/i);
    expect(gap).toMatch(/again/i);
  });

  it("treats a pending document as neither missing nor rejected", () => {
    expect(
      describeKycGap([
        { doc_type: "AADHAAR", status: "PENDING" },
        { doc_type: "PAN", status: "PENDING" },
      ]),
    ).toBeNull();
  });
});
