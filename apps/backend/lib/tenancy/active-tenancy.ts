import { prisma } from "@/lib/db";
import { LIVE_TENANCY_STATUSES, selectLiveTenancy } from "./live-tenancy";

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

export {
  LIVE_TENANCY_STATUSES,
  selectLiveTenancy,
  selectCurrentTenancy,
  isLiveTenancyStatus,
  liveTenancyInclude,
} from "./live-tenancy";
export type { LiveTenancyStatus } from "./live-tenancy";

/**
 * Prisma `where` fragment selecting a profile's live tenancy.
 *
 * Use this anywhere a query used to say `where: { profile_id }` and relied on the
 * old global unique constraint to return "the" tenancy. Without the status filter
 * a returning tenant resolves to whichever row Postgres happens to return first —
 * quite possibly the hostel they left.
 */
export function liveTenancyWhere(profileId: string) {
  return { profile_id: profileId, status: { in: [...LIVE_TENANCY_STATUSES] } };
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
