/**
 * Telling a seeker who a hostel takes, before they enquire.
 *
 * A boys-only or girls-only hostel has already answered "what gender is this
 * resident" by admitting them — which is why onboarding skips the question
 * entirely for those hostels (`identity-field-policy.ts` on the server,
 * `hostelType.ts` on the owner side). The seeker is never asked it either.
 *
 * What they *do* need is to know before spending an enquiry, so this is a
 * disclosure with an acknowledgement, not a gender picker. Deliberately not a
 * stored field: the hostel type already establishes the answer, and recording
 * a second copy at enquiry time would create two sources for one fact that can
 * disagree — exactly what the derivation rule exists to avoid.
 *
 * Co-living, working-professionals and an unset type disclose nothing, because
 * there is nothing to disclose: those tenants choose their gender during
 * onboarding as they always have.
 */

export interface AudienceConfirmation {
  /** Whether the enquiry screen must show and gate on this. */
  required: boolean;
  /** "This hostel takes boys only" — stated, not asked. */
  statement: string | null;
  /** The acknowledgement beside the checkbox. */
  acknowledgement: string | null;
}

const NONE: AudienceConfirmation = { required: false, statement: null, acknowledgement: null };

export function audienceConfirmation(hostelType: string | null | undefined): AudienceConfirmation {
  const code = String(hostelType || '').trim().toUpperCase();

  if (code === 'BOYS') {
    return {
      required: true,
      statement: 'This hostel takes boys only.',
      acknowledgement: 'I understand, and this applies to me',
    };
  }
  if (code === 'GIRLS') {
    return {
      required: true,
      statement: 'This hostel takes girls only.',
      acknowledgement: 'I understand, and this applies to me',
    };
  }
  return NONE;
}
