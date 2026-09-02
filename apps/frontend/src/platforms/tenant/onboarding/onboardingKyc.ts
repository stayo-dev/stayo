/**
 * KYC documents the Identity step collects — the pure rules the wizard renders
 * over. Node-only testable; no React, no DOM.
 *
 * Mirrors the backend's `src/services/tenants/kyc-status.ts`. The two must
 * agree: the backend is the authority (it validates uploads and derives
 * `document_verified`), this is only what the wizard shows and gates on.
 *
 * Onboarding never waits for owner approval (spec §4, §17): a document just has
 * to be uploaded — PENDING is enough to continue. A REJECTED document does not
 * count; the tenant re-uploads it in place.
 */

export const KYC_REQUIRED_BY_PROFILE_TYPE: Record<'STUDENT' | 'WORKING_PROFESSIONAL', string[]> = {
  STUDENT: ['AADHAAR', 'COLLEGE_ID'],
  WORKING_PROFESSIONAL: ['AADHAAR', 'WORK_ID'],
};

export const KYC_DOC_LABEL: Record<string, string> = {
  AADHAAR: 'Aadhaar',
  COLLEGE_ID: 'College ID',
  WORK_ID: 'Work ID',
};

export type OnboardingDocItem = {
  doc_type: string;
  document_status: string;
  rejection_reason?: string | null;
};

export function requiredKycDocTypes(profileType?: string | null): string[] {
  const key = String(profileType || 'STUDENT').toUpperCase();
  return key === 'WORKING_PROFESSIONAL'
    ? [...KYC_REQUIRED_BY_PROFILE_TYPE.WORKING_PROFESSIONAL]
    : [...KYC_REQUIRED_BY_PROFILE_TYPE.STUDENT];
}

export function kycDocLabel(docType: string): string {
  return KYC_DOC_LABEL[docType] ?? docType;
}

/** A type is satisfied for *continuing onboarding* once it has been uploaded. */
export function isDocUploaded(item: OnboardingDocItem | undefined): boolean {
  if (!item) return false;
  const status = String(item.document_status || '').toUpperCase();
  return status === 'PENDING' || status === 'APPROVED' || status === 'VERIFIED';
}

/** Required types with nothing usable uploaded yet (missing or rejected). */
export function missingKycDocs(
  profileType: string | null | undefined,
  items: OnboardingDocItem[] | null | undefined,
): string[] {
  const list = Array.isArray(items) ? items : [];
  return requiredKycDocTypes(profileType).filter(
    (type) => !isDocUploaded(list.find((item) => String(item.doc_type).toUpperCase() === type)),
  );
}

/** Every required document has at least been uploaded — safe to continue. */
export function canContinuePastDocuments(
  profileType: string | null | undefined,
  items: OnboardingDocItem[] | null | undefined,
): boolean {
  return missingKycDocs(profileType, items).length === 0;
}
