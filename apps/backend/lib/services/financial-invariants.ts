export function operationalPendingInvariantHolds(
  pendingAmount: number,
  unpaidTenantCount: number,
): boolean {
  // Invariant: zero operational pending implies zero operational unpaid tenants.
  if (pendingAmount <= 0) return unpaidTenantCount === 0;
  return true;
}
