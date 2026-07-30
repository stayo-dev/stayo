import crypto from "crypto";
import { prisma } from "../db";
import { eventLog } from "./event-log-service";

function dateOnly(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function hashSnapshot(payload: Record<string, any>) {
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export class HostelDailySnapshotService {
  /**
   * The real per-hostel financial rollup — shared by `createSnapshot()` (the
   * write path, persisted to `hostel_daily_snapshots`) and `previewLive()`
   * (the read-only fallback used whenever no snapshot exists yet for today,
   * e.g. a freshly-created hostel before the nightly snapshot cron has run).
   * Previously `previewLive()` hardcoded every money field to 0 instead of
   * running this query, which made the Owner portfolio/dashboard revenue and
   * dues KPIs silently show ₹0 for any hostel without a same-day snapshot
   * row, even though per-tenant dues (computed independently, live, from
   * `rent_obligations` directly) were correct — a real cross-surface
   * inconsistency, not just a display bug.
   */
  private async computeLiveStats(hostelId: string, day: Date) {
    const [row] = await prisma.$queryRaw<any[]>`
      WITH room_stats AS (
        SELECT
          COALESCE(SUM(capacity), 0)::int AS capacity
        FROM rooms
        WHERE hostel_id = ${hostelId}::uuid AND is_active = true
      ), active_allocations AS (
        SELECT COUNT(*)::int AS active_tenants
        FROM room_allocations
        WHERE hostel_id = ${hostelId}::uuid AND is_active = true AND end_date IS NULL
      ), obligations AS (
        SELECT
          COALESCE(SUM(amount), 0)::float AS expected_revenue,
          COALESCE(SUM(CASE WHEN status IN ('PENDING','PARTIAL') THEN amount ELSE 0 END), 0)::float AS pending_dues,
          COUNT(CASE WHEN status IN ('PENDING','PARTIAL') AND due_date < ${day}::date THEN 1 END)::int AS overdue_count
        FROM rent_obligations
        WHERE hostel_id = ${hostelId}::uuid AND rent_month <= ${day}::date
      ), collections AS (
        SELECT COALESCE(SUM(amount_paid), 0)::float AS collected_revenue
        FROM payments
        WHERE hostel_id = ${hostelId}::uuid AND payment_date <= ${day}::date
      ), expense_stats AS (
        SELECT COALESCE(SUM(amount), 0)::float AS expenses
        FROM expenses
        WHERE hostel_id = ${hostelId}::uuid AND date <= ${day}::date
      )
      SELECT
        rs.capacity,
        aa.active_tenants,
        o.expected_revenue,
        c.collected_revenue,
        o.pending_dues,
        o.overdue_count,
        e.expenses
      FROM room_stats rs, active_allocations aa, obligations o, collections c, expense_stats e
    `;
    return row;
  }

  async createSnapshot(hostelId: string, snapshotDate = new Date()) {
    const day = dateOnly(snapshotDate);
    const row = await this.computeLiveStats(hostelId, day);

    const capacity = Number(row?.capacity || 0);
    const activeTenants = Number(row?.active_tenants || 0);
    const expectedRevenue = Number(row?.expected_revenue || 0);
    const collectedRevenue = Number(row?.collected_revenue || 0);
    const expenses = Number(row?.expenses || 0);
    const payload = {
      hostel_id: hostelId,
      snapshot_date: day.toISOString().slice(0, 10),
      occupancy_rate: capacity > 0 ? Math.round((activeTenants / capacity) * 10000) / 100 : 0,
      active_tenants: activeTenants,
      expected_revenue: expectedRevenue,
      collected_revenue: collectedRevenue,
      pending_dues: Number(row?.pending_dues || 0),
      overdue_count: Number(row?.overdue_count || 0),
      collection_rate: expectedRevenue > 0 ? Math.round((collectedRevenue / expectedRevenue) * 10000) / 100 : 0,
      expenses,
      profit: Math.round((collectedRevenue - expenses) * 100) / 100,
    };

    await (prisma as any).hostel_daily_snapshots.upsert({
      where: { hostel_id_snapshot_date: { hostel_id: hostelId, snapshot_date: day } },
      create: {
        id: crypto.randomUUID(),
        ...payload,
        snapshot_date: day,
        source_hash: hashSnapshot(payload),
      },
      update: {
        ...payload,
        snapshot_date: day,
        source_hash: hashSnapshot(payload),
      },
    });

    return payload;
  }

  async getSnapshotOrLive(hostelId: string, snapshotDate = new Date(), staleAfterHours = 30) {
    const day = dateOnly(snapshotDate);
    const snapshot = await (prisma as any).hostel_daily_snapshots.findUnique({
      where: { hostel_id_snapshot_date: { hostel_id: hostelId, snapshot_date: day } },
    });

    if (snapshot) {
      const ageMs = Date.now() - new Date(snapshot.created_at).getTime();
      const isStale = ageMs > staleAfterHours * 60 * 60 * 1000;
      if (isStale) {
        await eventLog.log("HOSTEL_SNAPSHOT_STALE", null, { hostel_id: hostelId, snapshot_date: day.toISOString() });
      }
      return { source: "snapshot", is_stale: isStale, data: snapshot };
    }

    const live = await this.previewLive(hostelId, day);
    return { source: "live", is_stale: true, data: live };
  }

  private async previewLive(hostelId: string, day: Date) {
    const row = await this.computeLiveStats(hostelId, day);

    const capacity = Number(row?.capacity || 0);
    const activeTenants = Number(row?.active_tenants || 0);
    const expectedRevenue = Number(row?.expected_revenue || 0);
    const collectedRevenue = Number(row?.collected_revenue || 0);
    const expenses = Number(row?.expenses || 0);
    return {
      hostel_id: hostelId,
      snapshot_date: day.toISOString().slice(0, 10),
      active_tenants: activeTenants,
      capacity: capacity,
      occupancy_rate: capacity > 0 ? Math.round((activeTenants / capacity) * 10000) / 100 : 0,
      expected_revenue: expectedRevenue,
      collected_revenue: collectedRevenue,
      pending_dues: Number(row?.pending_dues || 0),
      overdue_count: Number(row?.overdue_count || 0),
      collection_rate: expectedRevenue > 0 ? Math.round((collectedRevenue / expectedRevenue) * 10000) / 100 : 0,
      expenses,
      profit: Math.round((collectedRevenue - expenses) * 100) / 100,
    };
  }
}

export const hostelDailySnapshotService = new HostelDailySnapshotService();
