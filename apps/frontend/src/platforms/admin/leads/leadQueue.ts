/**
 * Queue shaping for the admin Leads screen.
 *
 * Sized for ~100 leads a day, which changes what the screen is for: it stops
 * being a list you browse and becomes a queue you work. That drives every
 * decision here — what counts as actionable, what order things come in, and
 * what a keystroke does.
 *
 * Pure, so all of it is testable in the node-only environment.
 */

export type LeadStatus =
  | 'NEW'
  | 'UNDER_REVIEW'
  | 'APPROVED'
  | 'INVITE_SENT'
  | 'OWNER_ACTIVATED'
  | 'HOSTEL_CREATED'
  | 'LIVE'
  | 'LOST';

export type AdminLead = {
  id: string;
  name: string;
  hostel_name: string;
  phone: string;
  city: string | null;
  status: string;
  created_at: string;
  phone_verified?: boolean;
  notes?: string | null;
  applicant_message?: string | null;
};

/**
 * Statuses an admin can still act on.
 *
 * `APPROVED` is included because it means "approved, but the activation link
 * failed to send" — it needs a retry, not a decision (see
 * lead-invitation-service).
 */
export const ACTIONABLE_STATUSES: LeadStatus[] = ['NEW', 'UNDER_REVIEW', 'APPROVED'];

/** Statuses where the funnel is progressing on its own. */
export const IN_FLIGHT_STATUSES: LeadStatus[] = ['INVITE_SENT', 'OWNER_ACTIVATED', 'HOSTEL_CREATED'];

export const STATUS_LABEL: Record<string, string> = {
  NEW: 'New',
  UNDER_REVIEW: 'Under review',
  APPROVED: 'Send failed',
  INVITE_SENT: 'Invite sent',
  OWNER_ACTIVATED: 'Activated',
  HOSTEL_CREATED: 'Hostel created',
  LIVE: 'Live',
  LOST: 'Not proceeding',
};

/** Tone per status, so the list reads at a glance rather than word by word. */
export const STATUS_TONE: Record<string, 'action' | 'progress' | 'done' | 'dead'> = {
  NEW: 'action',
  UNDER_REVIEW: 'action',
  APPROVED: 'action',
  INVITE_SENT: 'progress',
  OWNER_ACTIVATED: 'progress',
  HOSTEL_CREATED: 'progress',
  LIVE: 'done',
  LOST: 'dead',
};

export function isActionable(status: string): boolean {
  return (ACTIONABLE_STATUSES as string[]).includes(String(status).toUpperCase());
}

/** Can this lead be rejected? Mirrors canRejectLead on the server. */
export function canReject(status: string): boolean {
  const s = String(status).toUpperCase();
  return s === 'NEW' || s === 'UNDER_REVIEW';
}

/** Can this lead be approved (or its failed send retried)? */
export function canApprove(status: string): boolean {
  return isActionable(status);
}

/**
 * Working order: actionable first and oldest-first within that, everything
 * else after in most-recent order.
 *
 * Oldest-first among actionable is the important half — newest-first pushes
 * whoever has waited longest further down every time a new lead arrives, and
 * at 100/day that person is never reached.
 */
export function sortForQueue(leads: AdminLead[]): AdminLead[] {
  return [...leads].sort((a, b) => {
    const aAct = isActionable(a.status);
    const bAct = isActionable(b.status);
    if (aAct !== bAct) return aAct ? -1 : 1;
    if (aAct) return a.created_at.localeCompare(b.created_at);
    return b.created_at.localeCompare(a.created_at);
  });
}

/** How long this lead has been waiting, in plain words. */
export function ageLabel(iso: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';

  const minutes = Math.floor((now - then) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;

  const days = Math.floor(hours / 24);
  return `${days}d`;
}

/** Untouched for too long. Only meaningful for leads still awaiting a decision. */
export function isStale(lead: AdminLead, now: number = Date.now()): boolean {
  if (!isActionable(lead.status)) return false;
  const then = new Date(lead.created_at).getTime();
  if (!Number.isFinite(then)) return false;
  return now - then > 24 * 60 * 60 * 1000;
}

/** Clamped keyboard stepping through the list. */
export function stepIndex(length: number, current: number, delta: number): number {
  if (length === 0) return 0;
  return Math.min(length - 1, Math.max(0, current + delta));
}

/**
 * Which of the selected ids can actually be rejected in bulk.
 *
 * A bulk action that silently skips some of what was selected is worse than
 * one that says so up front, so the caller gets both halves.
 */
export function partitionForBulkReject(
  leads: AdminLead[],
  selectedIds: Set<string>,
): { eligible: AdminLead[]; skipped: AdminLead[] } {
  const eligible: AdminLead[] = [];
  const skipped: AdminLead[] = [];
  for (const lead of leads) {
    if (!selectedIds.has(lead.id)) continue;
    (canReject(lead.status) ? eligible : skipped).push(lead);
  }
  return { eligible, skipped };
}
