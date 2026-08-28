export type AccessMode = 'SELF_SERVE' | 'OWNER_MANAGED';

/**
 * Null for the common case: a badge on every row is noise, and an
 * owner-managed tenant is a full tenant, not a degraded one. The label states
 * a fact about reach, never a problem to fix.
 */
export function accessModeLabel(mode: AccessMode | string | undefined | null): string | null {
  return mode === 'OWNER_MANAGED' ? 'Not on app' : null;
}
