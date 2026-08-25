/**
 * Shared types and pure helpers for the tenant activation flow.
 *
 * Ported from `portal/pages/ActivateAccountPage.tsx` — same contract shapes
 * the backend's `activation-workflow-service.ts` `getContext()`/`mutate()`
 * already return, just relocated so every step component can share one
 * definition instead of redeclaring it.
 */

export type ActivationStep = 'ACCOUNT' | 'RULES' | 'AGREEMENT' | 'PROFILE' | 'ACTIVATE';

export type RuleCategory = {
  id: string;
  title: string;
  severity?: 'standard' | 'important' | 'critical';
  icon?: string;
  highlights?: string[];
  rules?: string[];
};

export type ActivationContext = {
  activation_state: {
    current_step: ActivationStep;
    completed_steps: ActivationStep[];
    blocked_steps: ActivationStep[];
    /** False when this hostel does not require a signed agreement (ADR-059). */
    agreement_required?: boolean;
    account_setup_completed: boolean;
    rules_accepted: boolean;
    agreement_signed: boolean;
    profile_completed: boolean;
    documents_uploaded: boolean;
    activation_completed: boolean;
  };
  current_step: ActivationStep;
  verification_status?: { guardian_verified?: boolean; emergency_verified?: boolean };
  profile: { name?: string; email?: string; phone?: string };
  /**
   * The number the invitation was addressed to, and whether the backend can
   * already vouch for it — because the linked account verified it at enquiry
   * time, or because the invitation link was delivered to it over WhatsApp.
   * Optional: absent means "cannot vouch", and the Identity screen asks for an
   * OTP, which is the safe default.
   */
  phone_trust?: { phone: string | null; trusted: boolean } | null;
  /**
   * Which identity fields still have to be asked for. `required: false` means
   * the hostel's own type already establishes the gender, so the selector is
   * not rendered and the server derives it. Absent means ask — fail safe.
   */
  identity_fields?: { required: boolean; value: string | null; reason: string } | null;
  tenant: Record<string, string | number | null | undefined>;
  hostel: { name?: string; logo_url?: string; address?: string; phone?: string };
  room_summary: Record<string, string | number | boolean | string[] | null | undefined>;
  rules: {
    title?: string;
    version?: string;
    content?: { categories?: RuleCategory[] };
    required_acknowledgements?: string[];
  };
  agreement: {
    /**
     * The term the owner set — stored on the agreement since it was drafted but
     * only sent to the client from 2026-08-25 (ADR-112). Before that the
     * Agreement screen could not state how long the stay was for, so people
     * signed an eleven-month commitment without ever seeing the number.
     */
    term?: {
      duration_months: number | null;
      start_date: string | null;
      end_date: string | null;
      monthly_rent: number | null;
      security_deposit: number | null;
    } | null;
    /** Present once the tenant has given their word; see agreement-commitment. */
    commitment?: {
      acknowledged_at: string;
      duration_months: number | null;
      start_date: string | null;
      end_date: string | null;
      statement: string;
    } | null;
    id: string;
    status: string;
    signed_at?: string | null;
    pdf_url?: string | null;
    content_snapshot: Record<string, any>;
    tenant_signature_url?: string | null;
    tenant_signature_name?: string | null;
    tenant_signed_at?: string | null;
    guardian_signature_url?: string | null;
    guardian_signature_name?: string | null;
    guardian_relation?: string | null;
    guardian_signed_at?: string | null;
    owner_signature_url?: string | null;
    owner_signature_name?: string | null;
    owner_signed_at?: string | null;
  } | null;
  documents: { uploaded_count?: number; verification_status?: string };
  missing_fields?: { tier_1_required?: string[] };
};

export function normalizeActivationToken(value: string | null | undefined) {
  const raw = String(value || '').trim();
  if (!raw) return '';

  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    decoded = raw;
  }

  return decoded
    .replace(/^\/?(activate|invite)\//i, '')
    .replace(/^(\{\{4\}\}|\{\{1\}\}|%7B%7B4%7D%7D|%7B%7B1%7D%7D|\{1\}|%7B1%7D)+/i, '')
    .trim();
}

export const currency = (value: unknown) =>
  Number(value || 0).toLocaleString('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  });

export const fmtDate = (value: unknown) =>
  value ? new Date(String(value)).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

export const phoneDigits = (value: unknown) => String(value || '').replace(/\D/g, '').slice(-10);

export const guardianRelations = ['Father', 'Mother', 'Brother', 'Sister', 'Uncle', 'Aunt', 'Grandparent', 'Spouse', 'Other'];

export const activationMessages = [
  'Activating your account...',
  'Setting up your room access...',
  'Preparing tenant portal...',
];

export function duplicatePhoneMessage(values: { primary?: string; emergency?: string; guardian?: string }) {
  const entries = [
    ['Primary mobile', phoneDigits(values.primary)],
    ['Emergency mobile', phoneDigits(values.emergency)],
    ['Guardian mobile', phoneDigits(values.guardian)],
  ].filter(([, value]) => String(value || '').length > 0);

  for (const [, value] of entries) {
    if (String(value).length !== 10) continue;
    const matches = entries.filter(([, candidate]) => candidate === value);
    if (matches.length > 1) {
      return `${matches.map(([label]) => label).join(' and ')} must be different numbers.`;
    }
  }
  return '';
}

export function invalidPhoneMessage(
  values: { primary?: string; emergency?: string; guardian?: string },
  fields?: ('primary' | 'emergency' | 'guardian')[]
) {
  const allEntries = [
    ['primary', 'Primary mobile', values.primary, true],
    ['emergency', 'Emergency mobile', values.emergency, true],
    ['guardian', 'Guardian mobile', values.guardian, false],
  ] as const;

  const entries = fields ? allEntries.filter(([k]) => fields.includes(k)) : allEntries;

  for (const [, label, value, required] of entries) {
    const rawValue = String(value || '').trim();
    const digits = rawValue.replace(/\D/g, '');
    if (!rawValue && !required) continue;
    if (!/^[6-9]\d{9}$/.test(digits)) {
      return `${label} must be a valid 10-digit Indian mobile number.`;
    }
  }
  return '';
}

export type ProfileDraft = {
  profile: Record<string, string>;
  selectedCollege: string;
  selectedCourse: string;
  photoUrl: string;
  guardianOtpVerified?: boolean;
  guardianVerifiedPhone?: string;
  savedAt: number;
};

function profileDraftKey(token: string) {
  return `hms:tenant-activation:${token}:profile-draft`;
}

export function readProfileDraft(token: string): ProfileDraft | null {
  if (!token || typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(profileDraftKey(token));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ProfileDraft>;
    if (!parsed.profile || typeof parsed.profile !== 'object') return null;
    return {
      profile: parsed.profile as Record<string, string>,
      selectedCollege: String(parsed.selectedCollege || ''),
      selectedCourse: String(parsed.selectedCourse || ''),
      photoUrl: String(parsed.photoUrl || ''),
      guardianOtpVerified: Boolean(parsed.guardianOtpVerified),
      guardianVerifiedPhone: String(parsed.guardianVerifiedPhone || ''),
      savedAt: Number(parsed.savedAt || Date.now()),
    };
  } catch {
    return null;
  }
}

export function writeProfileDraft(token: string, draft: Omit<ProfileDraft, 'savedAt'>) {
  if (!token || typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(profileDraftKey(token), JSON.stringify({ ...draft, savedAt: Date.now() }));
  } catch {
    // Local draft save is best-effort. Backend save still remains authoritative.
  }
}

export function clearProfileDraft(token: string) {
  if (!token || typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(profileDraftKey(token));
  } catch {
    // Ignore storage failures.
  }
}
