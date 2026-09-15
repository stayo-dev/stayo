/**
 * The numbers on a host card (ADR-200) — counted from existing records, never
 * stored, so they cannot drift from the reviews and tenancies they describe.
 *
 * Every figure is one the owner earned *on Stayo*. The self-reported
 * "running hostels since" year is a separate fact and is never folded in:
 * "240 residents since 2015" would claim a history Stayo cannot see.
 */

export interface HostStats {
  review_count: number;
  /** Average of PUBLISHED reviews, one decimal; null with no reviews. */
  rating: number | null;
  /** Distinct residents ever housed, rounded for display; null below 5. */
  residents: number | null;
}

export const RESIDENTS_MIN_SHOWN = 5;

/**
 * Below five the count is omitted — "2 residents" reads as a warning, not a
 * credential. Five to nine stay exact; from ten the figure floors to the ten
 * and the client adds "+", so it never overstates.
 */
export function publicResidents(count: number): number | null {
  if (!Number.isFinite(count) || count < RESIDENTS_MIN_SHOWN) return null;
  if (count < 10) return count;
  return Math.floor(count / 10) * 10;
}

export function roundRating(avg: number | null | undefined, count: number): number | null {
  if (!count || avg === null || avg === undefined || !Number.isFinite(Number(avg))) return null;
  return Math.round(Number(avg) * 10) / 10;
}

/**
 * Host-level, across every hostel the owner runs — the same scope a resident
 * means by "this host". Bulk-imported tenants count: they are real residents.
 *
 * Residents are scoped through the hostel rather than `tenants.owner_id`: that
 * column is nullable, and every tenancy has a hostel.
 */
export async function loadHostStats(db: any, ownerId: string): Promise<HostStats & { verified: boolean }> {
  const [reviews, residents, verifiedDocs] = await Promise.all([
    db.hostel_reviews.aggregate({
      where: { status: "PUBLISHED", hostel: { owner_id: ownerId } },
      _count: { _all: true },
      _avg: { rating: true },
    }),
    db.tenants.findMany({
      where: { hostels: { owner_id: ownerId }, status: { in: ["ACTIVE", "FORMER_TENANT"] }, profile_id: { not: null } },
      select: { profile_id: true },
      distinct: ["profile_id"],
    }),
    db.owner_documents.count({
      where: { profile_id: ownerId, is_active: true, status: "VERIFIED", doc_type: { in: ["AADHAAR", "PAN"] } },
    }),
  ]);

  const reviewCount = Number(reviews?._count?._all ?? 0);
  return {
    review_count: reviewCount,
    rating: roundRating(reviews?._avg?.rating, reviewCount),
    residents: publicResidents(Array.isArray(residents) ? residents.length : 0),
    verified: Number(verifiedDocs) > 0,
  };
}
