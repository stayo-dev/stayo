import { prisma } from "../db";
import { hostelDailySnapshotService } from "./hostel-daily-snapshot-service";
import { dashboardSnapshotService, type PortfolioStats } from "./dashboard-snapshot-service";

export interface HostelCard {
  hostel_id: string;
  name: string;
  city: string | null;
  is_active: boolean;
  status: string;
  active_tenants: number;
  total_capacity: number;
  occupancy_rate: number;
  collected_revenue: number;
  pending_dues: number;
  overdue_count: number;
  collection_rate: number;
  snapshot_date: string;
  snapshot_source: "snapshot" | "live";
  is_stale: boolean;
  /// Owner-controlled Home ordering. `null` means never reordered — see ADR-042.
  display_order: number | null;
}

export interface PortfolioSummary {
  aggregate: PortfolioStats;
  hostels: HostelCard[];
  hostel_count: number;
  computed_at: string;
}

/**
 * PortfolioService
 *
 * Provides the portfolio overview for the authenticated owner.
 *
 * Architectural invariant: ALL per-hostel metrics come from hostel_daily_snapshots.
 * Aggregate metrics come from DashboardSnapshotService which itself reads from
 * hostel_daily_snapshots — no raw transactional tables are queried here.
 */
export class PortfolioService {

  async getPortfolioSummary(ownerId: string): Promise<PortfolioSummary> {
    const hostels = await prisma.hostels.findMany({
      where: { owner_id: ownerId, status: { in: ["ACTIVE", "INACTIVE"] } },
      select: { id: true, name: true, city: true, is_active: true, status: true, display_order: true },
      // NULLs last, then name — so a hostel the owner has never reordered keeps
      // exactly the position it had before display_order existed, and a newly
      // created hostel appends rather than jumping to the top. See ADR-042.
      orderBy: [{ display_order: { sort: "asc", nulls: "last" } }, { name: "asc" }],
    });

    const today = new Date();

    // Fetch per-hostel snapshots (or live fallback) in parallel.
    const snapshotResults = await Promise.all(
      hostels.map((h) => hostelDailySnapshotService.getSnapshotOrLive(h.id, today))
    );

    // `hostel_daily_snapshots` has no `capacity` column (occupancy_rate is
    // computed and stored, but the raw bed count isn't) — read live instead
    // of through the money-metrics snapshot cache, since room capacity
    // doesn't change day to day and doesn't need daily snapshotting.
    const capacityRows = await prisma.rooms.groupBy({
      by: ["hostel_id"],
      where: { hostel_id: { in: hostels.map((h) => h.id) }, is_active: true },
      _sum: { capacity: true },
    });
    const capacityByHostel = new Map(capacityRows.map((r) => [r.hostel_id, Number(r._sum.capacity ?? 0)]));

    const hostelCards: HostelCard[] = hostels.map((h, i) => {
      const { source, is_stale, data: s } = snapshotResults[i];
      const capacity       = capacityByHostel.get(h.id) ?? 0;
      const activeTenants  = Number(s.active_tenants  ?? 0);
      const collected      = Number(s.collected_revenue ?? 0);
      const pending        = Number(s.pending_dues     ?? 0);
      const overdueCount   = Number(s.overdue_count    ?? 0);
      const expectedRev    = collected + pending;
      const collectionRate = expectedRev > 0
        ? Math.round((collected / expectedRev) * 10_000) / 100
        : 0;
      const occupancyRate  = capacity > 0
        ? Math.round((activeTenants / capacity) * 10_000) / 100
        : 0;

      return {
        hostel_id:         h.id,
        name:              h.name,
        city:              h.city,
        is_active:         h.is_active,
        status:            h.status,
        active_tenants:    activeTenants,
        total_capacity:    capacity,
        occupancy_rate:    occupancyRate,
        collected_revenue: collected,
        pending_dues:      pending,
        overdue_count:     overdueCount,
        collection_rate:   collectionRate,
        display_order:     h.display_order,
        snapshot_date:     typeof s.snapshot_date === "string"
          ? s.snapshot_date
          : today.toISOString().slice(0, 10),
        snapshot_source:   source as "snapshot" | "live",
        is_stale,
      };
    });

    // Aggregate stats from portfolio snapshot cache (backed by hostel daily snapshots).
    const aggregate = await dashboardSnapshotService.getPortfolioStats(ownerId);

    return {
      aggregate,
      hostels:       hostelCards,
      hostel_count:  hostels.length,
      computed_at:   new Date().toISOString(),
    };
  }

  /**
   * Force-refresh all hostel snapshots for an owner, then recompute portfolio.
   * Use this after bulk operations (e.g. mass rent generation) or from a cron.
   */
  async forceRefresh(ownerId: string): Promise<void> {
    const hostels = await prisma.hostels.findMany({
      where: { owner_id: ownerId, status: { in: ["ACTIVE", "INACTIVE"] } },
      select: { id: true },
    });

    await Promise.allSettled(
      hostels.map((h) => hostelDailySnapshotService.createSnapshot(h.id))
    );

    await dashboardSnapshotService.refreshPortfolioStats(ownerId);
  }
}

export const portfolioService = new PortfolioService();
