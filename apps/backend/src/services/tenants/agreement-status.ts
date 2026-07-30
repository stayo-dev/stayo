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
