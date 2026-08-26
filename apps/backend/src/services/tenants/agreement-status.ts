export const AGREEMENT_DOCUMENT_ACCESSIBLE_STATUSES = [
  "SIGNED",
  "EXPIRING_SOON",
  "AGREEMENT_EXPIRED",
  "RENEWED",
  "TERMINATED",
] as const;

export const CURRENT_AGREEMENT_STATUSES = [
  "SIGNED",
  "EXPIRING_SOON",
  "AGREEMENT_EXPIRED",
] as const;

/**
 * Agreements whose rent an owner may still change.
 *
 * Wider than CURRENT_AGREEMENT_STATUSES by exactly one status: **DRAFT**.
 *
 * A hostel with `tenant_rules.agreement_required = false` (ADR-059) never has
 * its tenants sign, so their `Agreement` row stays DRAFT for the whole
 * tenancy. The row is still created deliberately — agreement signing "governs
 * the signing ceremony only", and `contract_rent` on that record is what rent
 * changes, obligation generation, renewals and move-out settlement key to. So
 * a DRAFT agreement governs real money even though nobody signed it, and
 * `POST /api/tenants/:id/change-rent` refusing it made rent unchangeable for
 * every tenant of every such hostel.
 *
 * RENEWED and TERMINATED stay out: a later agreement governs, or none does,
 * and repricing either would rewrite a contract no longer in force.
 *
 * Deliberately separate from CURRENT_AGREEMENT_STATUSES rather than widening
 * it — "may this agreement's rent change?" and "is this a signed, current
 * agreement?" are different questions, and `currentAgreementWhere()` drives
 * owner-facing "Active Contract" copy that must keep saying Pending for an
 * unsigned draft.
 */
export const RENT_CHANGEABLE_AGREEMENT_STATUSES = [
  "DRAFT",
  "SIGNED",
  "EXPIRING_SOON",
  "AGREEMENT_EXPIRED",
] as const;

export const HISTORICAL_AGREEMENT_STATUSES = [
  "RENEWED",
  "TERMINATED",
] as const;

export const AGREEMENT_LIFECYCLE_MANAGED_STATUSES = [
  "SIGNED",
  "EXPIRING_SOON",
] as const;

export const AGREEMENT_ACTIVITY_EVENTS = {
  EXPIRING: "AGREEMENT_EXPIRING",
  EXPIRED: "AGREEMENT_EXPIRED",
  RENEWED: "AGREEMENT_RENEWED",
} as const;

function normalizeAgreementStatus(status: string | null | undefined) {
  return String(status || "").toUpperCase();
}

export function isAgreementDocumentAccessibleStatus(status: string | null | undefined) {
  return AGREEMENT_DOCUMENT_ACCESSIBLE_STATUSES.includes(normalizeAgreementStatus(status) as any);
}

export function agreementDocumentAccessibleWhere() {
  return { in: [...AGREEMENT_DOCUMENT_ACCESSIBLE_STATUSES] } as any;
}

export function isCurrentAgreementStatus(status: string | null | undefined) {
  return CURRENT_AGREEMENT_STATUSES.includes(normalizeAgreementStatus(status) as any);
}

export function currentAgreementWhere() {
  return { in: [...CURRENT_AGREEMENT_STATUSES] } as any;
}

export function isRentChangeableAgreementStatus(status: string | null | undefined) {
  return RENT_CHANGEABLE_AGREEMENT_STATUSES.includes(normalizeAgreementStatus(status) as any);
}

export function rentChangeableAgreementWhere() {
  return { in: [...RENT_CHANGEABLE_AGREEMENT_STATUSES] } as any;
}

export function isHistoricalAgreementStatus(status: string | null | undefined) {
  return HISTORICAL_AGREEMENT_STATUSES.includes(normalizeAgreementStatus(status) as any);
}

export function historicalAgreementWhere() {
  return { in: [...HISTORICAL_AGREEMENT_STATUSES] } as any;
}

export const SIGNED_AGREEMENT_STATUSES = AGREEMENT_DOCUMENT_ACCESSIBLE_STATUSES;

export function isSignedAgreementStatus(status: string | null | undefined) {
  return isAgreementDocumentAccessibleStatus(status);
}

export function signedAgreementStatusWhere() {
  return agreementDocumentAccessibleWhere();
}
