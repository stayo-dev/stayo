import { prisma } from "../db";
import { getLogger } from "../logger";
import { incrementSnapshot } from "../metrics";
import { acquireSystemLock, releaseSystemLock } from "../lock";
import { hostelDailySnapshotService } from "./hostel-daily-snapshot-service";

const logger = getLogger("portfolio-snapshot-service");

/**
 * Portfolio TTL — how long a freshly-computed portfolio row is trusted
 * before triggering a recompute on next read. Portfolio data is low-frequency;
 * 5-minute staleness is acceptable.
 */
const PORTFOLIO_TTL_MS = 5 * 60 * 1_000;

function utcMonthStart(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function toDate(v: any): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function isFresh(ts: Date | null, ttlMs: number): boolean {
  return !!ts && Date.now() - ts.getTime() <= ttlMs;
}

export interface PortfolioStats {
  total_rooms: number;
  total_capacity: number;
  active_tenants: number;
  vacant_beds: number;
  occupancy_rate: number;
  rent_collected_this_month: number;
  expenses_this_month: number;
  pending_dues: number;
  overdue_total: number;
  overdue_count: number;
  collection_rate: number;
}

/**
 * PortfolioSnapshotService
 *
 * Computes and caches portfolio-level aggregates for an owner by reading
 * exclusively from `hostel_daily_snapshots` (one row per hostel per day).
 *
 * Architectural invariant: NO raw transactional table (payments, obligations,
 * tenants) is ever queried here. Portfolio metrics are derived snapshots, not
 * live aggregations across all hostels.
 */
export class DashboardSnapshotService {

  /**
   * Mark portfolio snapshot stale for an owner.
   * Called when any hostel-level financial mutation occurs.
   */
  async markOwnerStale(ownerId: string) {
    const month = utcMonthStart(new Date());
    await prisma.$executeRaw`
      INSERT INTO owner_dashboard_snapshots (owner_id, snapshot_month, is_stale, updated_at)
      VALUES (${ownerId}::uuid, ${month}::date, true, NOW())
      ON CONFLICT (owner_id) DO UPDATE
      SET is_stale = true, updated_at = NOW()
    `;
  }

  /**
   * Returns cached portfolio stats if fresh; otherwise triggers a recompute
   * from hostel_daily_snapshots and returns the freshly-computed result.
   */
  async getPortfolioStats(ownerId: string): Promise<PortfolioStats> {
    const row = await this.fetchSnapshotRow(ownerId);
    const statsComputedAt = toDate(row?.stats_computed_at);
    const fresh = row && !row.is_stale && isFresh(statsComputedAt, PORTFOLIO_TTL_MS);

    if (fresh) {
      logger.info("portfolio_stats_hit", { owner_id: ownerId });
      incrementSnapshot("stats_hit");
      return this.mapStatsRow(row);
    }

    logger.info("portfolio_stats_miss", { owner_id: ownerId, is_stale: row?.is_stale ?? null });
    incrementSnapshot("stats_miss");

    await this.refreshPortfolioStats(ownerId);

    const updated = await this.fetchSnapshotRow(ownerId);
    if (updated) return this.mapStatsRow(updated);

    return this.emptyStats();
  }

  /**
   * Recompute portfolio snapshot by aggregating over today's hostel snapshots.
   * Writes result back to `owner_dashboard_snapshots`.
   * Protected by a per-owner system lock to prevent concurrent recomputes.
   */
  async refreshPortfolioStats(ownerId: string): Promise<void> {
    const lockKey = `portfolio_snapshot_${ownerId}`;
    const acquired = await acquireSystemLock(lockKey, 30);
    if (!acquired) {
      logger.info("portfolio_stats_lock_busy", { owner_id: ownerId });
      incrementSnapshot("lock_contention");
      return;
    }

    try {
      const hostels = await prisma.hostels.findMany({
        where: { owner_id: ownerId, status: { in: ["ACTIVE", "INACTIVE"] } },
        select: { id: true },
      });

      if (hostels.length === 0) {
        await this.writePortfolioRow(ownerId, this.emptyStats());
        return;
      }

      // Ensure today's snapshot exists for each hostel; use cached row if present.
      const today = new Date();
      const snapshots = await Promise.all(
        hostels.map((h) =>
          hostelDailySnapshotService.getSnapshotOrLive(h.id, today).then((r) => r.data)
        )
      );

      const agg = snapshots.reduce(
        (acc, s) => {
          const capacity        = Number(s.capacity           ?? s.active_tenants ?? 0);
          const activeTenants   = Number(s.active_tenants     ?? 0);
          const collected       = Number(s.collected_revenue  ?? 0);
          const expenses        = Number(s.expenses           ?? 0);
          const pending         = Number(s.pending_dues       ?? 0);
          const overdueCnt      = Number(s.overdue_count      ?? 0);
          // Derive overdue amount: use pending_dues as a proxy when overdue_amount is not stored
          const overdueAmount   = Number((s as any).overdue_amount ?? pending);

          acc.total_capacity               += capacity;
          acc.active_tenants               += activeTenants;
          acc.rent_collected_this_month    += collected;
          acc.expenses_this_month          += expenses;
          acc.pending_dues                 += pending;
          acc.overdue_total                += overdueAmount;
          acc.overdue_count                += overdueCnt;
          return acc;
        },
        {
          total_capacity: 0,
          active_tenants: 0,
          rent_collected_this_month: 0,
          expenses_this_month: 0,
          pending_dues: 0,
          overdue_total: 0,
          overdue_count: 0,
        }
      );

      const roomCounts = await prisma.rooms.groupBy({
        by: ["hostel_id"],
        where: { hostels: { owner_id: ownerId, status: { in: ["ACTIVE", "INACTIVE"] } }, is_active: true },
        _sum: { capacity: true },
        _count: { id: true },
      });

      const totalRooms    = roomCounts.reduce((s, r) => s + Number(r._count.id || 0), 0);
      const totalCapacity = roomCounts.reduce((s, r) => s + Number(r._sum.capacity || 0), 0);
      const vacantBeds    = Math.max(0, totalCapacity - agg.active_tenants);
      const occupancyRate = totalCapacity > 0
        ? Math.round((agg.active_tenants / totalCapacity) * 10_000) / 100
        : 0;

      // Expected revenue is collected + pending; guard against divide-by-zero.
      const expectedRevenue = agg.rent_collected_this_month + agg.pending_dues;
      const collectionRate  = expectedRevenue > 0
        ? Math.round((agg.rent_collected_this_month / expectedRevenue) * 10_000) / 100
        : 0;

      const stats: PortfolioStats = {
        total_rooms:               totalRooms,
        total_capacity:            totalCapacity,
        active_tenants:            agg.active_tenants,
        vacant_beds:               vacantBeds,
        occupancy_rate:            occupancyRate,
        rent_collected_this_month: agg.rent_collected_this_month,
        expenses_this_month:       agg.expenses_this_month,
        pending_dues:              agg.pending_dues,
        overdue_total:             agg.overdue_total,
        overdue_count:             agg.overdue_count,
        collection_rate:           collectionRate,
      };

      await this.writePortfolioRow(ownerId, stats);
      logger.info("portfolio_stats_refreshed", { owner_id: ownerId, hostels: hostels.length });
    } finally {
      await releaseSystemLock(lockKey);
    }
  }

  private async fetchSnapshotRow(ownerId: string) {
    const rows = await prisma.$queryRaw<any[]>`
      SELECT * FROM owner_dashboard_snapshots
      WHERE owner_id = ${ownerId}::uuid
      LIMIT 1
    `;
    return rows[0] ?? null;
  }

  private async writePortfolioRow(ownerId: string, s: PortfolioStats) {
    const snapshotMonth = utcMonthStart(new Date());
    const now           = new Date();
    await prisma.$executeRaw`
      INSERT INTO owner_dashboard_snapshots (
        owner_id, snapshot_month,
        active_tenant_count, total_room_count, total_capacity, vacant_beds, occupancy_rate,
        rent_collected_month, expenses_month, pending_dues, overdue_total, overdue_count,
        collection_rate, stats_computed_at, is_stale, updated_at
      ) VALUES (
        ${ownerId}::uuid, ${snapshotMonth}::date,
        ${s.active_tenants}, ${s.total_rooms}, ${s.total_capacity}, ${s.vacant_beds},
        ${s.occupancy_rate}, ${s.rent_collected_this_month}, ${s.expenses_this_month},
        ${s.pending_dues}, ${s.overdue_total}, ${s.overdue_count},
        ${s.collection_rate}, ${now}, false, NOW()
      )
      ON CONFLICT (owner_id) DO UPDATE SET
        snapshot_month          = EXCLUDED.snapshot_month,
        active_tenant_count     = EXCLUDED.active_tenant_count,
        total_room_count        = EXCLUDED.total_room_count,
        total_capacity          = EXCLUDED.total_capacity,
        vacant_beds             = EXCLUDED.vacant_beds,
        occupancy_rate          = EXCLUDED.occupancy_rate,
        rent_collected_month    = EXCLUDED.rent_collected_month,
        expenses_month          = EXCLUDED.expenses_month,
        pending_dues            = EXCLUDED.pending_dues,
        overdue_total           = EXCLUDED.overdue_total,
        overdue_count           = EXCLUDED.overdue_count,
        collection_rate         = EXCLUDED.collection_rate,
        stats_computed_at       = EXCLUDED.stats_computed_at,
        is_stale                = false,
        updated_at              = NOW()
    `;
  }

  private mapStatsRow(row: any): PortfolioStats {
    return {
      total_rooms:               Number(row.total_room_count        || 0),
      total_capacity:            Number(row.total_capacity          || 0),
      active_tenants:            Number(row.active_tenant_count     || 0),
      vacant_beds:               Number(row.vacant_beds             || 0),
      occupancy_rate:            Number(row.occupancy_rate          || 0),
      rent_collected_this_month: Number(row.rent_collected_month    || 0),
      expenses_this_month:       Number(row.expenses_month          || 0),
      pending_dues:              Number(row.pending_dues            || 0),
      overdue_total:             Number(row.overdue_total           || 0),
      overdue_count:             Number(row.overdue_count           || 0),
      collection_rate:           Number(row.collection_rate         || 0),
    };
  }

  private emptyStats(): PortfolioStats {
    return {
      total_rooms: 0, total_capacity: 0, active_tenants: 0, vacant_beds: 0,
      occupancy_rate: 0, rent_collected_this_month: 0, expenses_this_month: 0,
      pending_dues: 0, overdue_total: 0, overdue_count: 0, collection_rate: 0,
    };
  }
}

export const dashboardSnapshotService = new DashboardSnapshotService();
