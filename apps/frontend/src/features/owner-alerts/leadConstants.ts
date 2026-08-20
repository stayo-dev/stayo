/**
 * Shared between AlertsPage's Leads tab and LeadDetailSheet — previously
 * duplicated in both (SOURCE_LABEL existed twice with the same values).
 */

export const LEAD_SOURCE_LABEL: Record<string, string> = {
  DISCOVER: 'website',
  QR: 'QR code',
  WALK_IN: 'walk-in',
};

/** Still "under consideration" — the owner hasn't Accepted/Held/Rejected yet. Mirrors the backend's OPEN_STATUSES in lead-transition-guards.ts. */
export const LEAD_OPEN_STATUSES = ['NEW', 'INTERESTED', 'ROOM_VISITED', 'DECISION_PENDING', 'READY_TO_JOIN'];

export const LEAD_STATUS_LABEL: Record<string, string> = {
  NEW: 'New',
  INTERESTED: 'Interested',
  ROOM_VISITED: 'Room visited',
  DECISION_PENDING: 'Decision pending',
  READY_TO_JOIN: 'Ready to join',
  ACCEPTED: 'Accepted',
  ON_HOLD: 'On hold',
  REJECTED: 'Rejected',
  INVITED: 'Invited',
  JOINED: 'Joined',
  LOST: 'Not proceeding',
};

export function leadStatusLabel(status?: string | null): string {
  if (!status) return '';
  return LEAD_STATUS_LABEL[status] ?? status.replace(/_/g, ' ');
}

const LEAD_STATUS_TONE_CLASS: Record<string, string> = {
  NEW: 'bg-info/10 text-info',
  INTERESTED: 'bg-info/10 text-info',
  ROOM_VISITED: 'bg-info/10 text-info',
  DECISION_PENDING: 'bg-info/10 text-info',
  READY_TO_JOIN: 'bg-info/10 text-info',
  ACCEPTED: 'bg-success/10 text-success',
  ON_HOLD: 'bg-warning/10 text-warning',
  REJECTED: 'bg-destructive/10 text-destructive',
  INVITED: 'bg-success/10 text-success',
  JOINED: 'bg-success/10 text-success',
  LOST: 'bg-muted text-muted-foreground',
};

export function leadStatusToneClass(status?: string | null): string {
  if (!status) return 'bg-muted text-muted-foreground';
  return LEAD_STATUS_TONE_CLASS[status] ?? 'bg-muted text-muted-foreground';
}

/** Whether the Accept / Hold / Reject actions should be offered for this lead. Mirrors the backend's canTransitionLeadStatus in lead-transition-guards.ts. */
export function leadCanAcceptHoldReject(status?: string | null): boolean {
  if (!status) return false;
  return LEAD_OPEN_STATUSES.includes(status) || status === 'ON_HOLD';
}
