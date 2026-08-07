/**
 * Pure half of the tenancy helpers — deliberately imports nothing, so it can be
 * unit-tested under `npm run test:pure` (which never provisions a database).
 * The querying half lives in `active-tenancy.ts`.
 */

/** Statuses that make a tenancy "live". Kept in sync with migration 062's index. */
export const LIVE_TENANCY_STATUSES = ["INVITED", "ACTIVE"] as const;

export type LiveTenancyStatus = (typeof LIVE_TENANCY_STATUSES)[number];

export function isLiveTenancyStatus(status: unknown) {
  return (LIVE_TENANCY_STATUSES as readonly string[]).includes(String(status));
}

/**
 * The tenancy a profile is *currently about*: the live one if there is one,
 * otherwise the most recently created.
 *
 * Activation-link paths need this rather than `selectLiveTenancy`. They must still
 * be able to answer "this invitation was cancelled" or "…expired" — statuses that
 * are by definition not live, and which a live-only filter would collapse into a
 * uselessly generic "link invalid".
 *
 * Anything making an authorisation or money decision should use
 * `selectLiveTenancy` instead: "most recent" is a reasonable thing to *describe*,
 * never a reasonable thing to bill.
 */
export function selectCurrentTenancy<
  T extends { id: string; status: string; created_at?: Date | string | null }
>(tenancies: readonly T[] | null | undefined): T | null {
  const all = tenancies || [];
  const live = selectLiveTenancy(all);
  if (live) return live;

  return (
    [...all].sort(
      (a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
    )[0] || null
  );
}

/**
 * Prisma `include` fragment for `profile.tenants` that returns only the live
 * tenancy. `profile.tenants` is a list now, so an unfiltered include hands back
 * the person's whole stay history — including hostels they have left.
 *
 * Pair with `selectLiveTenancy` to unwrap it.
 */
export const liveTenancyInclude = {
  where: { status: { in: [...LIVE_TENANCY_STATUSES] } },
} as const;

/**
 * Given every tenancy row belonging to a profile, return the live one.
 *
 * Throws if more than one is live — that means the partial unique index
 * `tenants_one_live_tenancy_per_profile` is missing or was bypassed, and
 * continuing would silently attach money to the wrong hostel. Loud beats wrong.
 */
export function selectLiveTenancy<T extends { id: string; status: string }>(
  tenancies: readonly T[] | null | undefined
): T | null {
  const live = (tenancies || []).filter((tenancy) => isLiveTenancyStatus(tenancy.status));
  if (live.length > 1) {
    throw new Error(
      `INVARIANT_VIOLATION: profile has ${live.length} live tenancies (${live
        .map((tenancy) => tenancy.id)
        .join(", ")}) — tenants_one_live_tenancy_per_profile is not enforced`
    );
  }
  return live[0] || null;
}
