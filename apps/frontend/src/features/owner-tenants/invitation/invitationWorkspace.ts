/**
 * Owner-facing logic for the pre-activation invitation workspace.
 *
 * Everything the owner sees on that screen about *where the invitation is*
 * comes from data the backend already tracks on `tenant_invitations`
 * (`status`, `opened_at`, `activation_started_at`, `expires_at`) plus the
 * bed reservation. Nothing here invents state: before this module existed the
 * screen hardcoded "Expires in 3 days" and "Waiting for tenant to create
 * account" regardless of what had actually happened.
 *
 * Activation itself is deliberately absent. A tenant becomes ACTIVE only by
 * completing their own registration — there is no owner-side force-activate.
 */

import { formatIndianPhone, isSamePhone } from '@shared/lib/phone';

export type InvitationStatus =
  | 'PENDING'
  | 'OPENED'
  | 'ACTIVATION_STARTED'
  | 'CANCELLED'
  | 'EXPIRED'
  | 'ACTIVATED';

export interface InvitationLike {
  status?: string | null;
  sent_at?: string | null;
  expires_at?: string | null;
  opened_at?: string | null;
  activation_started_at?: string | null;
  reservation_expires_at?: string | null;
  revision?: number | null;
}

export type StepState = 'done' | 'current' | 'todo';

export interface ProgressStep {
  key: 'SENT' | 'OPENED' | 'REGISTERING' | 'ACTIVE';
  label: string;
  /** What actually happened, e.g. "2 days ago" — null when it hasn't yet. */
  at: string | null;
  state: StepState;
}

export interface InvitationProgress {
  steps: ProgressStep[];
  /** The one line that answers "what is happening right now?". */
  headline: string;
  /** The one line that answers "so what should I do?". */
  hint: string;
  /** True when the owner's most useful action is to chase the tenant. */
  needsNudge: boolean;
}

const MS_PER_DAY = 86_400_000;

function time(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : t;
}

/**
 * "2 days ago" / "today" / "in 3 days". Deliberately day-grained: an owner
 * chasing an invitation thinks in days, and minute-level precision here only
 * makes the line longer.
 */
export function relativeDayLabel(iso: string | null | undefined, now: number = Date.now()): string | null {
  const t = time(iso);
  if (t === null) return null;
  const days = Math.round((t - now) / MS_PER_DAY);
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  return days > 0 ? `in ${days} days` : `${Math.abs(days)} days ago`;
}

export interface ExpiryDescription {
  label: string;
  tone: 'ok' | 'warning' | 'danger';
  isExpired: boolean;
  daysLeft: number | null;
}

/**
 * The real deadline, from the invitation's own `expires_at`. Invitations
 * default to a 7-day window server-side, but the window is per-invitation and
 * shifts on every resend, so it is always read, never assumed.
 */
export function describeExpiry(
  expiresAt: string | null | undefined,
  now: number = Date.now(),
): ExpiryDescription {
  const t = time(expiresAt);
  if (t === null) return { label: 'No expiry set', tone: 'ok', isExpired: false, daysLeft: null };

  const daysLeft = Math.ceil((t - now) / MS_PER_DAY);
  if (daysLeft < 0) return { label: 'Link expired', tone: 'danger', isExpired: true, daysLeft };
  if (daysLeft === 0) return { label: 'Expires today', tone: 'danger', isExpired: false, daysLeft };
  if (daysLeft === 1) return { label: 'Expires tomorrow', tone: 'warning', isExpired: false, daysLeft };
  return {
    label: `Expires in ${daysLeft} days`,
    tone: daysLeft <= 2 ? 'warning' : 'ok',
    isExpired: false,
    daysLeft,
  };
}

/**
 * Turns the invitation's delivery funnel into a 4-step timeline.
 *
 * `status` is trusted for how far the tenant got; expiry is layered on top,
 * because an expired PENDING invitation is a materially different situation
 * from a fresh one and the status column alone never says so.
 */
export function deriveInvitationProgress(
  invitation: InvitationLike | null | undefined,
  now: number = Date.now(),
): InvitationProgress {
  const status = String(invitation?.status ?? 'PENDING').toUpperCase();
  const expiry = describeExpiry(invitation?.expires_at, now);

  const opened = Boolean(invitation?.opened_at) || status === 'OPENED' || status === 'ACTIVATION_STARTED';
  const registering = Boolean(invitation?.activation_started_at) || status === 'ACTIVATION_STARTED';
  const activated = status === 'ACTIVATED';

  let currentKey: ProgressStep['key'];
  if (activated) currentKey = 'ACTIVE';
  else if (registering) currentKey = 'ACTIVE';
  else if (opened) currentKey = 'REGISTERING';
  else currentKey = 'OPENED';

  const order: ProgressStep['key'][] = ['SENT', 'OPENED', 'REGISTERING', 'ACTIVE'];
  const doneKeys = new Set<ProgressStep['key']>(['SENT']);
  if (opened) doneKeys.add('OPENED');
  if (registering) doneKeys.add('REGISTERING');
  if (activated) doneKeys.add('ACTIVE');

  const labels: Record<ProgressStep['key'], string> = {
    SENT: 'Invitation sent',
    OPENED: 'Tenant opened link',
    REGISTERING: 'Creating account',
    ACTIVE: 'Tenancy active',
  };

  const at: Record<ProgressStep['key'], string | null> = {
    SENT: relativeDayLabel(invitation?.sent_at, now),
    OPENED: relativeDayLabel(invitation?.opened_at, now),
    REGISTERING: relativeDayLabel(invitation?.activation_started_at, now),
    ACTIVE: null,
  };

  const steps: ProgressStep[] = order.map((key) => ({
    key,
    label: labels[key],
    at: at[key],
    state: doneKeys.has(key) ? 'done' : key === currentKey ? 'current' : 'todo',
  }));

  if (status === 'CANCELLED') {
    return {
      steps,
      headline: 'Invitation cancelled',
      hint: 'This invitation was revoked. The bed has been released back to the room.',
      needsNudge: false,
    };
  }

  if (expiry.isExpired) {
    return {
      steps,
      headline: 'Invitation link expired',
      hint: 'Resend to issue a fresh link — the old one no longer works.',
      needsNudge: true,
    };
  }

  if (registering) {
    return {
      steps,
      headline: 'Tenant is creating their account',
      hint: 'They will appear as active once they finish registering. Terms are locked in.',
      needsNudge: false,
    };
  }

  if (opened) {
    return {
      steps,
      headline: 'Tenant opened the link',
      hint: 'They have seen the terms but have not registered yet.',
      needsNudge: false,
    };
  }

  return {
    steps,
    headline: 'Waiting for the tenant to open the link',
    hint: 'Not opened yet. A nudge on WhatsApp usually helps.',
    // Unopened for more than a day is the one case where chasing pays off.
    needsNudge: (() => {
      const sent = time(invitation?.sent_at);
      return sent === null ? false : now - sent > MS_PER_DAY;
    })(),
  };
}

// ── Draft terms ────────────────────────────────────────────────────────────

export type MaintenanceType = 'MONTHLY' | 'ONE_TIME' | 'NONE';

export interface DraftTerms {
  name: string;
  phone: string;
  email: string;
  hostelId: string;
  roomId: string;
  roomLabel: string;
  joiningDate: string;
  paymentFrequency: string;
  monthlyRent: number;
  deposit: number;
  maintenanceCharge: number;
  maintenanceType: MaintenanceType;
  agreementStartDate: string;
  agreementDurationMonths: number;
}

/**
 * The one move-in total. The profile view used to compute rent + deposit while
 * the edit form computed rent + deposit + one-time maintenance, so the same
 * labelled figure disagreed with itself between two screens of one flow.
 * Monthly maintenance is excluded on purpose — it is a recurring charge, not
 * part of what is owed on day one.
 */
export function computeMoveInTotal(terms: {
  monthlyRent: number;
  deposit: number;
  maintenanceCharge: number;
  maintenanceType: MaintenanceType;
}): number {
  const oneTimeMaintenance = terms.maintenanceType === 'ONE_TIME' ? Number(terms.maintenanceCharge || 0) : 0;
  return Number(terms.monthlyRent || 0) + Number(terms.deposit || 0) + oneTimeMaintenance;
}

export interface TermChange {
  field: keyof DraftTerms;
  label: string;
  from: string;
  to: string;
  /** Terms changes alter what the tenant agreed to; contact changes do not. */
  isFinancial: boolean;
}

const FIELD_LABELS: Partial<Record<keyof DraftTerms, string>> = {
  name: 'Name',
  phone: 'Phone',
  email: 'Email',
  roomId: 'Room',
  joiningDate: 'Move-in date',
  paymentFrequency: 'Billing frequency',
  monthlyRent: 'Monthly rent',
  deposit: 'Security deposit',
  maintenanceCharge: 'Maintenance',
  maintenanceType: 'Maintenance type',
  agreementStartDate: 'Agreement start',
  agreementDurationMonths: 'Agreement duration',
};

const FINANCIAL_FIELDS = new Set<keyof DraftTerms>([
  'roomId',
  'joiningDate',
  'paymentFrequency',
  'monthlyRent',
  'deposit',
  'maintenanceCharge',
  'maintenanceType',
  'agreementStartDate',
  'agreementDurationMonths',
]);

export function formatMoney(value: number): string {
  return `₹${Number(value || 0).toLocaleString('en-IN')}`;
}

function displayValue(field: keyof DraftTerms, terms: DraftTerms): string {
  switch (field) {
    case 'monthlyRent':
    case 'deposit':
    case 'maintenanceCharge':
      return formatMoney(Number(terms[field]));
    case 'agreementDurationMonths':
      return terms.agreementDurationMonths ? `${terms.agreementDurationMonths} months` : '—';
    case 'roomId':
      return terms.roomLabel || '—';
    case 'phone':
      return formatIndianPhone(terms.phone) || '—';
    default:
      return String(terms[field] ?? '') || '—';
  }
}

/**
 * What changed between the saved invitation and the owner's edits.
 *
 * This exists so the owner is never asked to confirm "some changes" — sending
 * a revised invitation expires the tenant's current link, so the confirmation
 * has to name every difference it is about to push.
 */
export function diffTerms(current: DraftTerms, draft: DraftTerms): TermChange[] {
  const fields = Object.keys(FIELD_LABELS) as (keyof DraftTerms)[];
  return fields.flatMap((field) => {
    const a = current[field];
    const b = draft[field];
    // Phones are compared by their digits: the same number can legitimately be
    // stored as `+91XXXXXXXXXX` and entered as `XXXXXXXXXX`, and a notation
    // difference is not an edit worth re-issuing the tenant's link for.
    const same = field === 'phone'
      ? isSamePhone(String(a ?? ''), String(b ?? ''))
      : typeof a === 'number' || typeof b === 'number'
        ? Number(a || 0) === Number(b || 0)
        : String(a ?? '').trim() === String(b ?? '').trim();
    if (same) return [];
    return [{
      field,
      label: FIELD_LABELS[field] as string,
      from: displayValue(field, current),
      to: displayValue(field, draft),
      isFinancial: FINANCIAL_FIELDS.has(field),
    }];
  });
}

export interface MissingItem {
  field: keyof DraftTerms;
  label: string;
}

/**
 * What still blocks a complete offer. A room is always present on a real
 * invitation (the backend requires `room_id` at invite time), so this
 * normally returns nothing — which is the point: the old screen showed
 * "⚠ Assign room" on every invited tenant because it read the room from
 * allocations, and those are only created at activation.
 */
export function missingTerms(draft: DraftTerms): MissingItem[] {
  const missing: MissingItem[] = [];
  if (!draft.roomId) missing.push({ field: 'roomId', label: 'Room not assigned' });
  if (!(draft.monthlyRent > 0)) missing.push({ field: 'monthlyRent', label: 'Monthly rent not set' });
  if (!draft.joiningDate) missing.push({ field: 'joiningDate', label: 'Move-in date not set' });
  if (!draft.phone) missing.push({ field: 'phone', label: 'Phone number missing' });
  return missing;
}
