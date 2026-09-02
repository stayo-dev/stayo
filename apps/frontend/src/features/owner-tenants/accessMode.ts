export type AccessMode = 'SELF_SERVE' | 'OWNER_MANAGED';
export type AcceptanceStatus = 'NOT_REQUIRED' | 'PENDING' | 'ACCEPTED';

/**
 * Null for the common case: a badge on every row is noise, and an
 * owner-managed tenant is a full tenant, not a degraded one. The label states
 * a fact about reach, never a problem to fix.
 */
export function accessModeLabel(mode: AccessMode | string | undefined | null): string | null {
  return mode === 'OWNER_MANAGED' ? 'Not on app' : null;
}

/**
 * The badge shown on an owner's tenant row / detail.
 *
 * `PENDING` (new model, ADR-165) — invited, in the room, rent running, but the
 * tenant has not personally accepted yet. `OWNER_MANAGED` with no PENDING
 * acceptance is a grandfathered row: the tenant just has no app login.
 */
export function acceptanceBadge(t: {
  acceptanceStatus?: string | null;
  accessMode?: string | null;
}): string | null {
  if (t.acceptanceStatus === 'PENDING') return 'Awaiting acceptance';
  if (t.accessMode === 'OWNER_MANAGED') return 'Not on app';
  return null;
}

/** Whether this tenant still needs to personally accept their invitation. */
export function isAwaitingAcceptance(t: {
  acceptanceStatus?: string | null;
}): boolean {
  return t.acceptanceStatus === 'PENDING';
}
