import { canSubmitIdentity, needsPhoneOtp, phoneDigits, type PhoneTrust } from '../steps/identityVerification';
import { emailAllowsSubmit, type EmailRequirement } from '../steps/emailVerification';
import { isDocUploaded, kycDocLabel, requiredKycDocTypes, type OnboardingDocItem } from '../onboardingKyc';
import { parseISODate, validateDateOfBirth } from '../steps/dateOfBirth';

/**
 * What is still standing between the tenant and the next step — the rules half
 * of the guidance system, with no DOM in it.
 *
 * Every message names the field and the action to take on it ("Upload your
 * Aadhaar"), never a verdict on what they typed ("Invalid input"): at the
 * volume this flow handles, a message that does not say what to do next
 * becomes a support call. The order of the returned list is the order the
 * fields appear on screen, because the UI walks it to decide where to scroll.
 *
 * These functions restate no rules of their own: phone/OTP trust comes from
 * `identityVerification`, email from `emailVerification`, documents from
 * `onboardingKyc`, dates from `dateOfBirth`. Anything that gates a submit
 * belongs in one of those, with this module only turning it into words.
 */

export type Issue = {
  /** Anchor id — matches the `useFieldAnchor(id)` on the control. `doc:AADHAAR` for a KYC row. */
  field: string;
  /** Short name for the summary chips. */
  label: string;
  /** Full sentence shown under the field. Says what to do. */
  message: string;
};

export type IdentityState = {
  /** False once ACCOUNT is saved: the phone/email fields are no longer on screen, so they cannot be fixed here. */
  showAccountFields: boolean;
  phone: string;
  otp: string;
  otpSent: boolean;
  phoneTrust: PhoneTrust | null;
  emailRequirement: EmailRequirement | null;
  email: string;
  emailVerifiedAs: string | null;
  genderRequired: boolean;
  gender: string;
  dateOfBirth: string;
  profileType: string;
  photoUploaded: boolean;
  docItems: OnboardingDocItem[];
};

export function identityIssues(state: IdentityState, today: Date = new Date()): Issue[] {
  const issues: Issue[] = [];

  if (!state.photoUploaded) {
    issues.push({ field: 'photo', label: 'Profile photo', message: 'Add a photo of yourself — tap the circle to take one.' });
  }

  if (state.showAccountFields) {
    const digits = phoneDigits(state.phone);
    const otpRequired = needsPhoneOtp({ enteredPhone: state.phone, trust: state.phoneTrust });
    if (digits.length !== 10) {
      issues.push({ field: 'phone', label: 'Mobile number', message: 'Enter your 10-digit mobile number.' });
    } else if (otpRequired && !state.otpSent) {
      issues.push({ field: 'phone', label: 'Mobile number', message: 'Tap Send to get a verification code on this number.' });
    } else if (!canSubmitIdentity({ enteredPhone: state.phone, trust: state.phoneTrust, otp: state.otp, otpSent: state.otpSent })) {
      issues.push({ field: 'otp', label: 'Verification code', message: `Enter the 6-digit code we sent to ${digits}.` });
    }

    if (!emailAllowsSubmit(state.emailRequirement, state.email, state.emailVerifiedAs)) {
      const message = state.email.trim()
        ? 'Confirm this email with the code we sent you.'
        : 'Add your email — your receipts and login go here.';
      issues.push({ field: 'email', label: 'Email', message });
    }
  }

  if (state.genderRequired && !state.gender) {
    issues.push({ field: 'gender', label: 'Gender', message: 'Choose one.' });
  }

  // The picker only ever emits a valid date, but a restored draft or an older
  // record can carry anything, so it is re-checked rather than trusted.
  const dob = validateDateOfBirth(parseISODate(state.dateOfBirth), today);
  if (!state.dateOfBirth) {
    issues.push({ field: 'date_of_birth', label: 'Date of birth', message: 'Add your date of birth.' });
  } else if (!dob.ok) {
    issues.push({ field: 'date_of_birth', label: 'Date of birth', message: `${dob.message}.` });
  }

  for (const docType of requiredKycDocTypes(state.profileType)) {
    const item = state.docItems.find((d) => String(d.doc_type).toUpperCase() === docType);
    const status = String(item?.document_status || 'MISSING').toUpperCase();
    if (status === 'REJECTED') {
      const reason = item?.rejection_reason ? ` — ${item.rejection_reason}` : '';
      issues.push({ field: `doc:${docType}`, label: kycDocLabel(docType), message: `Your ${kycDocLabel(docType)} needs uploading again${reason}.` });
    } else if (!isDocUploaded(item)) {
      issues.push({ field: `doc:${docType}`, label: kycDocLabel(docType), message: `Upload a photo of your ${kycDocLabel(docType)}.` });
    }
  }

  return issues;
}

/**
 * The GUARDIAN step's own rules (ADR-213).
 *
 * These used to live inside `identityIssues`, and were left there when the
 * screens were split — so pressing Continue on Identity reported things left to
 * do and then tried to scroll to controls that were no longer rendered. The
 * tenant saw a count they could not act on. Guidance has to move with the
 * fields it describes; that is the whole contract between this module and the
 * anchors.
 */
export type GuardianState = {
  name: string;
  relation: string;
  phone: string;
  verified: boolean;
  /**
   * Set when the tenant has said their guardian cannot confirm right now.
   * Satisfies the step exactly as verification does — ADR-212 made deferral a
   * legitimate way through, and guidance that kept asking anyway would be
   * telling them to do something the product has already accepted they cannot.
   */
  deferralReason: string | null;
};

export function guardianIssues(state: GuardianState): Issue[] {
  const issues: Issue[] = [];

  if (!state.name.trim()) {
    issues.push({ field: 'guardian_name', label: "Guardian's name", message: "Add your parent or guardian's full name." });
  }

  if (!state.relation.trim()) {
    issues.push({ field: 'guardian_relation', label: 'Relationship', message: 'Choose how they are related to you.' });
  }

  const digits = phoneDigits(state.phone);
  if (digits.length !== 10) {
    issues.push({ field: 'guardian_phone', label: "Guardian's mobile", message: "Enter your parent or guardian's 10-digit mobile number." });
  } else if (!state.verified && !state.deferralReason) {
    // Names all three ways out, in the order the screen offers them. "Verify
    // this number" was true and useless to someone whose parent is not picking
    // up — which is the case this step exists to handle.
    issues.push({
      field: 'guardian_phone',
      label: "Guardian's mobile",
      message: 'Ask them to confirm on WhatsApp, enter the code they were sent, or tell us they can’t right now.',
    });
  }

  return issues;
}

export function passwordIssues(state: { password: string; confirm: string }): Issue[] {
  if (state.password.length < 8) {
    return [{ field: 'password', label: 'Password', message: 'Use at least 8 characters.' }];
  }
  if (state.password !== state.confirm) {
    return [{ field: 'confirm_password', label: 'Repeat password', message: 'Both passwords need to match.' }];
  }
  return [];
}

export type AgreementState = {
  acknowledgements: Record<string, boolean>;
  /** Server truth: `agreements.document_read_completed_at` is set. */
  readCompleted: boolean;
  tenantSignature: boolean;
  tenantSignatureName: string;
  guardianSignature: boolean;
  guardianSignatureName: string;
  guardianRelation: string;
  /**
   * `policy.tenant_rules.guardian_signature_required`. Absent means not
   * required, matching the backend default — a hostel predating the setting
   * must not suddenly block its tenants.
   */
  guardianRequired?: boolean;
};

export function agreementIssues(state: AgreementState): Issue[] {
  const issues: Issue[] = [];

  // First, because there is no point telling someone to sign a document they
  // have not opened. Read from the server's record, not from local state, so a
  // reload cannot skip it.
  if (!state.readCompleted) {
    issues.push({
      field: 'agreement_document',
      label: 'Your agreement',
      message: 'Open the agreement and read it to the end before signing.',
    });
  }

  for (const [key, ticked] of Object.entries(state.acknowledgements)) {
    if (!ticked) issues.push({ field: `ack:${key}`, label: 'House rules', message: 'Tick this to confirm you have read it.' });
  }

  // The tenant signs. This used to accept "tenant, guardian, or both", which
  // meant a tenancy could be activated with no signature from the person who
  // actually lives there. Guardian is now a genuine co-signature.
  if (!state.tenantSignature) {
    issues.push({ field: 'tenant_signature', label: 'Signature', message: 'Sign here to accept your agreement.' });
  } else if (!state.tenantSignatureName.trim()) {
    issues.push({ field: 'tenant_signature_name', label: 'Your name', message: 'Type your full name under your signature.' });
  }

  // A guardian who signs must be fully identified whether or not they had to.
  if (state.guardianRequired && !state.guardianSignature) {
    issues.push({
      field: 'guardian_signature',
      label: 'Parent / Guardian',
      message: 'This hostel needs a parent or guardian to co-sign.',
    });
  }
  if (state.guardianSignature && !state.guardianSignatureName.trim()) {
    issues.push({ field: 'guardian_signature_name', label: "Guardian's name", message: "Type your parent or guardian's full name under their signature." });
  }
  if (state.guardianSignature && !state.guardianRelation.trim()) {
    issues.push({ field: 'guardian_relation', label: 'Relationship', message: 'Choose how they are related to you.' });
  }

  return issues;
}

/** The line above the action bar. Progress, not blame — "2 things left", never "2 errors". */
export function summarise(issues: Issue[]): string {
  if (issues.length === 0) return '';
  return `${issues.length} thing${issues.length === 1 ? '' : 's'} left`;
}
