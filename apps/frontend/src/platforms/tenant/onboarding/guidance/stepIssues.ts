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
  guardianName: string;
  guardianPhone: string;
  guardianVerified: boolean;
  photoUploaded: boolean;
  docItems: OnboardingDocItem[];
};

function isStudent(profileType: string): boolean {
  return String(profileType || 'STUDENT').toUpperCase() === 'STUDENT';
}

export function identityIssues(state: IdentityState, today: Date = new Date()): Issue[] {
  const issues: Issue[] = [];
  const student = isStudent(state.profileType);

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

  // A working professional need not name a guardian — but once they start
  // entering one, the half-filled pair has to be completed and verified.
  const guardianStarted = Boolean(state.guardianName.trim() || phoneDigits(state.guardianPhone));
  if (student || guardianStarted) {
    if (!state.guardianName.trim()) {
      issues.push({ field: 'guardian_name', label: "Guardian's name", message: "Add your parent or guardian's full name." });
    }
    const guardianDigits = phoneDigits(state.guardianPhone);
    if (guardianDigits.length !== 10) {
      issues.push({ field: 'guardian_phone', label: "Guardian's mobile", message: "Enter your parent or guardian's 10-digit mobile number." });
    } else if (!state.guardianVerified) {
      issues.push({ field: 'guardian_phone', label: "Guardian's mobile", message: 'Verify this number with the code we send to it.' });
    }
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
  tenantSignature: boolean;
  tenantSignatureName: string;
  guardianSignature: boolean;
  guardianSignatureName: string;
  guardianRelation: string;
};

export function agreementIssues(state: AgreementState): Issue[] {
  const issues: Issue[] = [];

  for (const [key, ticked] of Object.entries(state.acknowledgements)) {
    if (!ticked) issues.push({ field: `ack:${key}`, label: 'House rules', message: 'Tick this to confirm you have read it.' });
  }

  const tenantComplete = state.tenantSignature && Boolean(state.tenantSignatureName.trim());
  const guardianComplete = state.guardianSignature && Boolean(state.guardianSignatureName.trim()) && Boolean(state.guardianRelation.trim());

  if (state.tenantSignature && !state.tenantSignatureName.trim()) {
    issues.push({ field: 'tenant_signature_name', label: 'Your name', message: 'Type your full name under your signature.' });
  }
  if (state.guardianSignature && !state.guardianSignatureName.trim()) {
    issues.push({ field: 'guardian_signature_name', label: "Guardian's name", message: "Type your parent or guardian's full name under their signature." });
  }
  if (state.guardianSignature && !state.guardianRelation.trim()) {
    issues.push({ field: 'guardian_relation', label: 'Relationship', message: 'Choose how they are related to you.' });
  }
  if (!tenantComplete && !guardianComplete && issues.length === 0) {
    issues.push({ field: 'tenant_signature', label: 'Signature', message: 'Sign here — you or your parent/guardian.' });
  }

  return issues;
}

/** The line above the action bar. Progress, not blame — "2 things left", never "2 errors". */
export function summarise(issues: Issue[]): string {
  if (issues.length === 0) return '';
  return `${issues.length} thing${issues.length === 1 ? '' : 's'} left`;
}
