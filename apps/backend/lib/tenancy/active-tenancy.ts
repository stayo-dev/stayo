import { prisma } from "@/lib/db";

/**
 * A `tenants` row is one *tenancy* — one person's stay in one hostel — not one
 * person. A profile accumulates a row per hostel they have ever stayed in.
 *
 * At most one of those rows may be live at a time. "Live" means `INVITED` or
 * `ACTIVE`, and it is enforced by the partial unique index
 * `tenants_one_live_tenancy_per_profile` (migration 062), not by convention.
 *
 * Everything that used to read the singular `profile.tenants` relation must come
 * through here. Taking `profile.tenants[0]` would reintroduce exactly the class of
 * bug the backend's architectural-invariants check exists to prevent: silently
 * picking a row when several are possible.
 */

/** Statuses that make a tenancy "live". Kept in sync with migration 062's index. */
export const LIVE_TENANCY_STATUSES = ["INVITED", "ACTIVE"] as const;

export type LiveTenancyStatus = (typeof LIVE_TENANCY_STATUSES)[number];

/**
 * Pure: given every tenancy row belonging to a profile, return the live one.
 *
 * Separated from the query so the rule is unit-testable without a database, and
 * so callers that already hold the rows (a Prisma `include`) don't re-query.
 *
 * Throws if more than one row is live — that means the unique index is missing or
 * was bypassed, and continuing would silently attach money to the wrong hostel.
 */
export function selectLiveTenancy<T extends { id: string; status: string }>(
  tenancies: readonly T[] | null | undefined
): T | null {
  const live = (tenancies || []).filter((tenancy) =>
    (LIVE_TENANCY_STATUSES as readonly string[]).includes(String(tenancy.status))
  );
  if (live.length > 1) {
    throw new Error(
      `INVARIANT_VIOLATION: profile has ${live.length} live tenancies (${live
        .map((tenancy) => tenancy.id)
        .join(", ")}) — tenants_one_live_tenancy_per_profile is not enforced`
    );
  }
  return live[0] || null;
}

/** The profile's live tenancy, or null if they are not currently a tenant anywhere. */
export async function getActiveTenancy(profileId: string, tx?: any) {
  const id = String(profileId || "").trim();
  if (!id) return null;

  const db = tx || prisma;
  const tenancies = await db.tenants.findMany({
    where: { profile_id: id, status: { in: [...LIVE_TENANCY_STATUSES] } },
  });
  return selectLiveTenancy(tenancies);
}

/** As `getActiveTenancy`, but throws when the profile has no live tenancy. */
export async function requireActiveTenancy(profileId: string, tx?: any) {
  const tenancy = await getActiveTenancy(profileId, tx);
  if (!tenancy) throw new Error("NOT_FOUND: Profile has no active tenancy");
  return tenancy;
}

/**
 * Every tenancy the profile has ever held, newest first — the stay history that
 * the old one-row-per-person model could not represent.
 */
export async function listTenancies(profileId: string, tx?: any) {
  const id = String(profileId || "").trim();
  if (!id) return [];

  const db = tx || prisma;
  return db.tenants.findMany({
    where: { profile_id: id },
    orderBy: { created_at: "desc" },
  });
}
