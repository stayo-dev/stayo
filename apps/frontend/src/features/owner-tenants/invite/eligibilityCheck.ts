import {
  buildTenancyConflictCopy,
  type TenancyConflict,
  type TenancyConflictCode,
  type TenancyDisclosure,
} from '@features/tenants/tenancyConflict';

/** Shape of `GET /owners/invitations/eligibility`'s response. */
export interface EligibilityPreview {
  has_account: boolean;
  eligible: boolean;
  code: TenancyConflictCode | null;
  disclosure: TenancyDisclosure | null;
}

/**
 * Builds the same OWN/OTHER-aware conflict copy `parseTenancyConflict` builds
 * from a 409 error, but from a pre-submit 200 preview instead — so the invite
 * wizard can show the blocked card before the owner ever hits Submit.
 */
export function conflictFromPreview(preview: EligibilityPreview): TenancyConflict | null {
  if (preview.eligible || !preview.code) return null;
  return buildTenancyConflictCopy(preview.code, preview.disclosure ?? {});
}
