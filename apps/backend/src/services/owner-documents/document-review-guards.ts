/**
 * Rules for reviewing an owner KYC document.
 *
 * Pure — no I/O — so the transitions are testable under vitest.pure.config.ts
 * and the same rules apply wherever review happens.
 */

export const REVIEWABLE_STATUSES = ["PENDING"] as const;
export const REVIEW_DECISIONS = ["VERIFIED", "REJECTED"] as const;

export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];

export type GuardResult = { ok: true } | { ok: false; reason: string };

export function isReviewDecision(value: unknown): value is ReviewDecision {
  return REVIEW_DECISIONS.includes(String(value).toUpperCase() as ReviewDecision);
}

/**
 * A document can be reviewed only while it is PENDING.
 *
 * Re-reviewing an already-decided document would silently overwrite an
 * earlier admin's decision with no record that it happened; if a decision
 * genuinely needs reversing, the owner re-uploads, which supersedes the old
 * row via the `(profile_id, doc_type, is_active)` unique constraint.
 */
export function canReviewDocument(status: string): GuardResult {
  const normalized = String(status || "").toUpperCase();
  if ((REVIEWABLE_STATUSES as readonly string[]).includes(normalized)) return { ok: true };
  if (normalized === "VERIFIED") {
    return { ok: false, reason: "This document has already been verified." };
  }
  if (normalized === "REJECTED") {
    return { ok: false, reason: "This document was already rejected — the owner needs to upload a new one." };
  }
  return { ok: false, reason: `Cannot review a document with status ${normalized}.` };
}

/**
 * A rejection must say why. Approving needs no note.
 *
 * A rejection with no reason just makes the owner upload the same file again,
 * which wastes their time and the reviewer's.
 */
export function validateReview(decision: ReviewDecision, note: string | null | undefined): GuardResult {
  if (decision === "REJECTED" && !String(note || "").trim()) {
    return { ok: false, reason: "A reason is required when rejecting — the owner is shown it." };
  }
  return { ok: true };
}

/** The two documents an owner must have verified before a hostel can go live. */
export const REQUIRED_DOC_TYPES = ["AADHAAR", "PAN"] as const;

/**
 * Is this owner's identity verification complete?
 *
 * PHOTO is deliberately excluded: it helps tenants trust a listing but is not
 * an identity document, so it must not gate going live.
 */
export function isOwnerKycComplete(documents: Array<{ doc_type: string; status: string }>): boolean {
  return REQUIRED_DOC_TYPES.every((required) =>
    documents.some(
      (doc) =>
        String(doc.doc_type).toUpperCase() === required &&
        String(doc.status).toUpperCase() === "VERIFIED",
    ),
  );
}

/** What still stands between this owner and a verified identity. */
export function describeKycGap(documents: Array<{ doc_type: string; status: string }>): string | null {
  const missing: string[] = [];
  const rejected: string[] = [];

  for (const required of REQUIRED_DOC_TYPES) {
    const doc = documents.find((d) => String(d.doc_type).toUpperCase() === required);
    const status = String(doc?.status || "").toUpperCase();
    if (!doc) missing.push(required);
    else if (status === "REJECTED") rejected.push(required);
  }

  if (rejected.length > 0) return `${rejected.join(" and ")} was rejected — please upload it again.`;
  if (missing.length > 0) return `${missing.join(" and ")} still to upload.`;
  return null;
}
