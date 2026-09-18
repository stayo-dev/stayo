export const AREA_MIN = 2;
export const AREA_MAX = 120;
export const HOSTEL_NAME_MIN = 3;
export const HOSTEL_NAME_MAX = 120;

export interface CoverageDraft {
  area: string;
  contact: string;
}

export interface CoveragePayload {
  kind: 'AREA';
  area_query: string;
  contact?: string;
  source: string;
}

export interface CoverageValidation {
  valid: boolean;
  errors: { area?: string; contact?: string };
  payload: CoveragePayload | null;
}

/** A student naming a hostel that should be on Stayo. */
export interface HostelReferralDraft {
  hostelName: string;
  ownerContact: string;
}

export interface HostelReferralPayload {
  kind: 'HOSTEL';
  hostel_name: string;
  owner_contact?: string;
  source: string;
}

export interface HostelReferralValidation {
  valid: boolean;
  errors: { hostelName?: string; ownerContact?: string };
  payload: HostelReferralPayload | null;
}

export type SupplyPayload = CoveragePayload | HostelReferralPayload;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const INDIAN_MOBILE = /^[6-9]\d{9}$/;

export type ContactKind = 'empty' | 'phone' | 'email' | 'invalid';

/** What the optional contact field holds, if anything. */
export function classifyContact(raw: string): ContactKind {
  const value = raw.trim();
  if (!value) return 'empty';
  if (value.includes('@')) return EMAIL.test(value) ? 'email' : 'invalid';
  const digits = value.replace(/\D/g, '');
  const local = digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits;
  return INDIAN_MOBILE.test(local) ? 'phone' : 'invalid';
}

/**
 * Validates the area request.
 *
 * The area alone is a complete, valid submission. Contact is a second,
 * optional field — gating the signal behind a phone number trades most of the
 * demand data for a little of the contact data, which is the wrong way round
 * when the demand is what recruits owners. The server re-validates all of
 * this; it is the authority, and this exists so the form can say why before
 * a round trip.
 */
export function validateCoverage(draft: CoverageDraft, source = 'HOME'): CoverageValidation {
  const errors: { area?: string; contact?: string } = {};
  const area = draft.area.trim();

  if (area.length < AREA_MIN) {
    errors.area = 'Tell us the college or area you are looking near.';
  } else if (area.length > AREA_MAX) {
    errors.area = `Keep this under ${AREA_MAX} characters.`;
  }

  const contactKind = classifyContact(draft.contact);
  if (contactKind === 'invalid') {
    errors.contact = 'Enter a mobile number or an email — or leave it blank.';
  }

  if (errors.area || errors.contact) {
    return { valid: false, errors, payload: null };
  }

  const payload: CoveragePayload = { kind: 'AREA', area_query: area, source };
  if (contactKind !== 'empty') payload.contact = draft.contact.trim();
  return { valid: true, errors: {}, payload };
}

/**
 * Validates a hostel referral.
 *
 * This is student-led owner acquisition: the student names the hostel they
 * already live in or want, and Stayo approaches the owner. The owner's number
 * is the single most valuable field on the page — it turns a name into a call —
 * but it stays optional, because a hostel name alone is still findable and
 * demanding the number would lose most of the referrals.
 */
export function validateHostelReferral(draft: HostelReferralDraft, source = 'HOME'): HostelReferralValidation {
  const errors: { hostelName?: string; ownerContact?: string } = {};
  const hostelName = draft.hostelName.trim();

  if (hostelName.length < HOSTEL_NAME_MIN) {
    errors.hostelName = 'Tell us the name of the hostel.';
  } else if (hostelName.length > HOSTEL_NAME_MAX) {
    errors.hostelName = `Keep this under ${HOSTEL_NAME_MAX} characters.`;
  }

  const contactKind = classifyContact(draft.ownerContact);
  if (contactKind === 'invalid') {
    errors.ownerContact = "Enter the owner's mobile number — or leave it blank.";
  }

  if (errors.hostelName || errors.ownerContact) {
    return { valid: false, errors, payload: null };
  }

  const payload: HostelReferralPayload = { kind: 'HOSTEL', hostel_name: hostelName, source };
  if (contactKind !== 'empty') payload.owner_contact = draft.ownerContact.trim();
  return { valid: true, errors: {}, payload };
}
