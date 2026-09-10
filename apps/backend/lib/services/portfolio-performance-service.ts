import { prisma } from "../db";
import { Prisma } from "@prisma/client";
import { formatShortMonth } from "../format";
import { roomCapacityService } from "./room-capacity-service";

export interface PortfolioPerformanceHostelMonth {
  hostel_id: string;
  hostel_name: string;
  revenue: number;
  collections: number;
  expenses: number;
  profit: number;
  occupancy_rate: number;
  pending_dues: number;
}

export interface PortfolioPerformanceMonth {
  month: string;
  month_key: string;
  total_revenue: number;
  total_due: number;
  total_expenses: number;
  total_profit: number;
  hostels: PortfolioPerformanceHostelMonth[];
}

export interface PortfolioPerformanceRanking {
  hostel_id: string;
  hostel_name: string;
  city: string | null;
  status: string;
  /** Null until the owner is asked. Drives the Hostels tab's "who stays here?" prompt. */
  hostel_type: string | null;
  archived_at: string | null;
  archive_reason: string | null;
  revenue: number;
  expenses: number;
  profit: number;
  occupancy_rate: number;
  collection_rate: number;
  pending_dues: number;
  active_tenants: number;
  occupied_beds: number;
  reserved_beds: number;
  total_capacity: number;
  vacant_beds: number;
  trend_percentage: number;
  is_top_performer: boolean;
}

export interface BusinessHealthInsight {
  highest_profit_hostel: { hostel_name: string; profit: number } | null;
  lowest_occupancy_hostel: { hostel_name: string; occupancy_rate: number } | null;
  highest_outstanding_hostel: { hostel_name: string; pending_dues: number } | null;
}

export interface PortfolioPerformanceResponse {
  portfolio: {
    total_revenue: number;
    total_expenses: number;
    total_profit: number;
    total_due: number;
    occupancy_rate: number;
    active_tenants: number;
    occupied_beds: number;
    reserved_beds: number;
    collection_rate: number;
    total_capacity: number;
    vacant_beds: number;
    move_out_open: number;
    pending_invites: number;
  };
  monthly_trends: PortfolioPerformanceMonth[];
  hostel_rankings: PortfolioPerformanceRanking[];
  business_health_insights: BusinessHealthInsight;
  top_performer_hostel_id: string | null;
  computed_at: string;
}

function monthRanges(months: number) {
  const now = new Date();
  return Array.from({ length: months }, (_, i) => {
    const targetMonth = now.getUTCMonth() - (months - 1 - i);
    const targetYear = now.getUTCFullYear() + Math.floor(targetMonth / 12);
    const normalizedMonth = ((targetMonth % 12) + 12) % 12;
    const start = new Date(Date.UTC(targetYear, normalizedMonth, 1, 0, 0, 0, 0));
    const end = new Date(Date.UTC(targetYear, normalizedMonth + 1, 0, 23, 59, 59, 999));
    const monthKey = `${targetYear}-${String(normalizedMonth + 1).padStart(2, "0")}`;
    return { start, end, monthKey, label: formatShortMonth(start) };
  });
}

function trendPct(current: number, previous: number): number {
  if (previous <= 0) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

export class PortfolioPerformanceService {
  async getPortfolioPerformance(ownerId: string, months = 6): Promise<PortfolioPerformanceResponse> {
    const boundedMonths = Math.max(1, Math.min(12, months));
    const ranges = monthRanges(boundedMonths);

    const rangeValues = Prisma.join(
      ranges.map((range) => Prisma.sql`
        (${range.monthKey}, ${range.label}, ${range.start}::date, ${range.end}::date)
      `),
      ","
    );

    const firstRange = ranges[0];
    const lastRange = ranges[ranges.length - 1];

    // Fetch all hostels including archived for lifecycle-aware UI
    const hostelStatusRows = await prisma.hostels.findMany({
      where: { owner_id: ownerId },
      select: { id: true, status: true, archived_at: true, archive_reason: true, hostel_type: true },
    });
    // Typed explicitly: `new Map(rows.map(...))` inferred the value as `{}`,
    // so every read off it below was an error, and adding a field simply added
    // another. The annotation fixes all of them at the source.
    const hostelStatusMap = new Map<
      string,
      { status: string; archived_at: Date | null; archive_reason: string | null; hostel_type: string | null }
    >(
      hostelStatusRows.map((h) => [
        h.id,
        {
          status: h.status,
          archived_at: h.archived_at,
          archive_reason: h.archive_reason,
          hostel_type: h.hostel_type,
        },
      ])
    );

    const [activeTenantRows, cashflowGrid, expenseGrid, moveOutResult, pendingInviteResult] = (await Promise.all([
      prisma.$queryRaw<Array<{ hostel_id: string; active_tenants: number }>>`
        SELECT
          h.id::text AS hostel_id,
          COUNT(t.id)::float AS active_tenants
        FROM hostels h
        LEFT JOIN tenants t
          ON t.hostel_id = h.id
          AND t.owner_id = ${ownerId}::uuid
          AND t.status = 'ACTIVE'
        WHERE h.owner_id = ${ownerId}::uuid AND h.status != 'ARCHIVED'
        GROUP BY h.id
      `,
      prisma.$queryRaw<Array<{
        month_key: string;
        month_label: string;
        hostel_id: string;
        hostel_name: string;
        city: string | null;
        revenue: number;
        collections: number;
        pending_dues: number;
        collection_rate: number;
      }>>`
        WITH ranges(month_key, month_label, start_date, end_date) AS (
          VALUES ${rangeValues}
        ), active_hostels AS (
          SELECT id, name, city
          FROM hostels
          WHERE owner_id = ${ownerId}::uuid AND status != 'ARCHIVED'
        ), pay_agg AS (
          SELECT obligation_id, SUM(amount_paid)::float AS total_paid
          FROM payments
          GROUP BY obligation_id
        )
        SELECT
          r.month_key,
          r.month_label,
          h.id::text AS hostel_id,
          h.name AS hostel_name,
          h.city,
          COALESCE(SUM(COALESCE(o.total_amount, o.amount) - GREATEST(COALESCE(o.total_amount, o.amount) - COALESCE(pay_agg.total_paid, 0), 0)), 0)::float AS revenue,
          COALESCE(SUM(COALESCE(o.total_amount, o.amount) - GREATEST(COALESCE(o.total_amount, o.amount) - COALESCE(pay_agg.total_paid, 0), 0)), 0)::float AS collections,
          COALESCE(SUM(GREATEST(COALESCE(o.total_amount, o.amount) - COALESCE(pay_agg.total_paid, 0), 0)), 0)::float AS pending_dues,
          CASE
            WHEN COALESCE(SUM(COALESCE(o.total_amount, o.amount)), 0) > 0
              THEN ROUND((COALESCE(SUM(COALESCE(o.total_amount, o.amount) - GREATEST(COALESCE(o.total_amount, o.amount) - COALESCE(pay_agg.total_paid, 0), 0)), 0) / SUM(COALESCE(o.total_amount, o.amount)) * 10000)::numeric) / 100
            ELSE 0
          END::float AS collection_rate
        FROM ranges r
        CROSS JOIN active_hostels h
        LEFT JOIN rent_obligations o
          ON o.owner_id = ${ownerId}::uuid
          AND o.hostel_id = h.id
          AND o.status <> 'WAIVED'
          AND o.rent_month >= r.start_date
          AND o.rent_month <= r.end_date
          AND EXISTS (
            SELECT 1
            FROM tenants t
            WHERE t.id = o.tenant_id
              AND t.status = 'ACTIVE'
          )
        LEFT JOIN pay_agg ON pay_agg.obligation_id = o.id
        GROUP BY r.month_key, r.month_label, h.id, h.name, h.city
        ORDER BY r.month_key ASC, h.name ASC
      `,
      // Expense aggregation by hostel by month for the same date range
      prisma.$queryRaw<Array<{
        month_key: string;
        hostel_id: string | null;
        expenses: number;
      }>>`
        WITH ranges(month_key, month_label, start_date, end_date) AS (
          VALUES ${rangeValues}
        )
        SELECT
          r.month_key,
          e.hostel_id::text AS hostel_id,
          COALESCE(SUM(e.amount), 0)::float AS expenses
        FROM ranges r
        JOIN expenses e
          ON e.owner_id = ${ownerId}::uuid
          AND e.date >= r.start_date::date
          AND e.date <= r.end_date::date
        GROUP BY r.month_key, e.hostel_id
        ORDER BY r.month_key ASC
      `,
      prisma.$queryRaw<Array<{ move_out_open: number }>>`
        SELECT COUNT(*)::int AS move_out_open
        FROM move_out_requests
        WHERE owner_id = ${ownerId}::uuid
          AND status NOT IN ('COMPLETED', 'REJECTED')
      `,
      prisma.$queryRaw<Array<{ pending_invites: number }>>`
        SELECT COUNT(*)::int AS pending_invites
        FROM tenants
        WHERE owner_id = ${ownerId}::uuid
          AND status = 'INVITED'
      `,
    ])) as [
      Array<{ hostel_id: string; active_tenants: number }>,
      Array<{
        month_key: string;
        month_label: string;
        hostel_id: string;
        hostel_name: string;
        city: string | null;
        revenue: number;
        collections: number;
        pending_dues: number;
        collection_rate: number;
      }>,
      Array<{
        month_key: string;
        hostel_id: string | null;
        expenses: number;
      }>,
      Array<{ move_out_open: number }>,
      Array<{ pending_invites: number }>
    ];

    // Build expense lookup: monthKey -> hostelId -> amount
    const expenseMap = new Map<string, Map<string | null, number>>();
    for (const row of expenseGrid) {
      if (!expenseMap.has(row.month_key)) expenseMap.set(row.month_key, new Map());
      expenseMap.get(row.month_key)!.set(row.hostel_id, Number(row.expenses || 0));
    }

    const activeTenantMap = new Map(
      activeTenantRows.map((row) => [row.hostel_id, Number(row.active_tenants || 0)]),
    );

    const hostelIds = Array.from(new Set(cashflowGrid.map((row) => row.hostel_id)));
    const capacityEntries = await Promise.all(
      hostelIds.map(async (hostelId) => {
        const roomMap = await roomCapacityService.getHostelCapacityMap(hostelId, { ownerId });
        const snapshots = Array.from(roomMap.values());
        const totalCapacity = snapshots.reduce((sum, snapshot) => sum + Number(snapshot.capacity || 0), 0);
        const occupiedBeds = snapshots.reduce((sum, snapshot) => sum + Number(snapshot.occupied || 0), 0);
        const reservedBeds = snapshots.reduce((sum, snapshot) => sum + Number(snapshot.reserved || 0), 0);
        const vacantBeds = snapshots.reduce((sum, snapshot) => sum + Number(snapshot.available || 0), 0);

        return [
          hostelId,
          {
            activeTenants: activeTenantMap.get(hostelId) || 0,
            occupiedBeds,
            reservedBeds,
            totalCapacity,
            vacantBeds,
            occupancy: totalCapacity > 0
              ? Math.round((occupiedBeds / totalCapacity) * 10000) / 100
              : 0,
          },
        ] as const;
      }),
    );
    const capacityMap = new Map(capacityEntries);
    const cashflowRows = cashflowGrid.map((row) => {
      const revenue = Number(row.revenue || 0);
      const expenses = expenseMap.get(row.month_key)?.get(row.hostel_id) ?? 0;
      return {
        monthKey: row.month_key,
        monthLabel: row.month_label,
        hostel_id: row.hostel_id,
        hostel_name: row.hostel_name,
        city: row.city,
        revenue,
        collections: Number(row.collections || 0),
        expenses,
        profit: revenue - expenses,
        occupancy_rate: capacityMap.get(row.hostel_id)?.occupancy ?? 0,
        pending_dues: Number(row.pending_dues || 0),
        collection_rate: Number(row.collection_rate || 0),
      };
    });
    const hostelMeta = Array.from(
      new Map(
        cashflowRows.map((row) => [
          row.hostel_id,
          {
            id: row.hostel_id,
            name: row.hostel_name,
            city: row.city,
          },
        ])
      ).values()
    );

    const monthly_trends: PortfolioPerformanceMonth[] = ranges.map((range) => {
      const monthHostels = cashflowRows.filter((row) => row.monthKey === range.monthKey);
      const totalRevenue = monthHostels.reduce((s, h) => s + h.revenue, 0);
      const totalDue = monthHostels.reduce((s, h) => s + h.pending_dues, 0);
      const totalExpenses = expenseGrid
        .filter((row) => row.month_key === range.monthKey)
        .reduce((sum, row) => sum + Number(row.expenses || 0), 0);
      return {
        month: range.label,
        month_key: range.monthKey,
        total_revenue: totalRevenue,
        total_due: totalDue,
        total_expenses: totalExpenses,
        total_profit: totalRevenue - totalExpenses,
        hostels: monthHostels.map(({ hostel_id, hostel_name, revenue, collections, expenses, profit, occupancy_rate, pending_dues }) => ({
          hostel_id,
          hostel_name,
          revenue,
          collections,
          expenses,
          profit,
          occupancy_rate,
          pending_dues,
        })),
      };
    });

    const currentKey = ranges[ranges.length - 1]?.monthKey;
    const previousKey = ranges[ranges.length - 2]?.monthKey;

    const currentByHostel = new Map(
      cashflowRows.filter((r) => r.monthKey === currentKey).map((r) => [r.hostel_id, r])
    );
    const previousByHostel = new Map(
      cashflowRows.filter((r) => r.monthKey === previousKey).map((r) => [r.hostel_id, r])
    );
    const currentRows = cashflowRows.filter((r) => r.monthKey === currentKey);

    let rankings: PortfolioPerformanceRanking[] = hostelMeta.map((h) => {
      const cur = currentByHostel.get(h.id);
      const prev = previousByHostel.get(h.id);
      const capacity = capacityMap.get(h.id);
      const revenue = cur?.revenue ?? 0;
      const expenses = cur?.expenses ?? 0;
      const prevRevenue = prev?.revenue ?? 0;
      const activeTenants = capacity?.activeTenants ?? 0;
      const occupiedBeds = capacity?.occupiedBeds ?? 0;
      const reservedBeds = capacity?.reservedBeds ?? 0;
      const totalCapacity = capacity?.totalCapacity ?? 0;
      const hostelStatus = hostelStatusMap.get(h.id);
      return {
        hostel_id: h.id,
        hostel_name: h.name,
        city: h.city,
        status: hostelStatus?.status ?? 'ACTIVE',
        archived_at: hostelStatus?.archived_at?.toISOString() ?? null,
        archive_reason: hostelStatus?.archive_reason ?? null,
        hostel_type: hostelStatus?.hostel_type ?? null,
        revenue,
        expenses,
        profit: revenue - expenses,
        occupancy_rate: cur?.occupancy_rate ?? 0,
        collection_rate: cur?.collection_rate ?? 0,
        pending_dues: cur?.pending_dues ?? 0,
        active_tenants: activeTenants,
        occupied_beds: occupiedBeds,
        reserved_beds: reservedBeds,
        total_capacity: totalCapacity,
        vacant_beds: capacity?.vacantBeds ?? Math.max(totalCapacity - occupiedBeds - reservedBeds, 0),
        trend_percentage: trendPct(revenue, prevRevenue),
        is_top_performer: false,
      };
    });

    rankings.sort((a, b) => {
      if (b.revenue !== a.revenue) return b.revenue - a.revenue;
      if (b.collection_rate !== a.collection_rate) return b.collection_rate - a.collection_rate;
      return b.occupancy_rate - a.occupancy_rate;
    });

    const topId = rankings[0]?.hostel_id ?? null;
    if (topId) {
      rankings = rankings.map((r) => ({
        ...r,
        is_top_performer: r.hostel_id === topId && r.revenue > 0,
      }));
    }

    const aggregateRevenue = currentRows.reduce((sum, row) => sum + Number(row.revenue || 0), 0);
    const aggregateExpenses = expenseGrid
      .filter((row) => row.month_key === currentKey)
      .reduce((sum, row) => sum + Number(row.expenses || 0), 0);
    const aggregateDue = currentRows.reduce((sum, row) => sum + Number(row.pending_dues || 0), 0);
    const aggregateActiveTenants = Array.from(capacityMap.values()).reduce(
      (sum, row) => sum + Number(row.activeTenants || 0),
      0
    );
    const aggregateOccupiedBeds = Array.from(capacityMap.values()).reduce(
      (sum, row) => sum + Number(row.occupiedBeds || 0),
      0
    );
    const aggregateReservedBeds = Array.from(capacityMap.values()).reduce(
      (sum, row) => sum + Number(row.reservedBeds || 0),
      0
    );
    const aggregateCapacity = Array.from(capacityMap.values()).reduce(
      (sum, row) => sum + Number(row.totalCapacity || 0),
      0
    );
    const aggregateVacantBeds = Array.from(capacityMap.values()).reduce(
      (sum, row) => sum + Number(row.vacantBeds || 0),
      0
    );
    const aggregateExpected = aggregateRevenue + aggregateDue;

    const moveOutOpen = Number(moveOutResult[0]?.move_out_open ?? 0);
    const pendingInvites = Number(pendingInviteResult[0]?.pending_invites ?? 0);

    // ── Business Health Insights ──────────────────────────────────────
    const rankingsWithData = rankings.filter((r) => r.revenue > 0 || r.expenses > 0 || r.pending_dues > 0);

    const highestProfitHostel = rankingsWithData.length > 0
      ? rankingsWithData.reduce((best, r) => r.profit > best.profit ? r : best, rankingsWithData[0])
      : null;

    const hostelsWithCapacity = rankings.filter((r) => r.total_capacity > 0);
    const lowestOccupancyHostel = hostelsWithCapacity.length > 0
      ? hostelsWithCapacity.reduce((worst, r) => r.occupancy_rate < worst.occupancy_rate ? r : worst, hostelsWithCapacity[0])
      : null;

    const hostelsWithDues = rankings.filter((r) => r.pending_dues > 0);
    const highestOutstandingHostel = hostelsWithDues.length > 0
      ? hostelsWithDues.reduce((worst, r) => r.pending_dues > worst.pending_dues ? r : worst, hostelsWithDues[0])
      : null;

    const business_health_insights: BusinessHealthInsight = {
      highest_profit_hostel: highestProfitHostel
        ? { hostel_name: highestProfitHostel.hostel_name, profit: highestProfitHostel.profit }
        : null,
      lowest_occupancy_hostel: lowestOccupancyHostel
        ? { hostel_name: lowestOccupancyHostel.hostel_name, occupancy_rate: lowestOccupancyHostel.occupancy_rate }
        : null,
      highest_outstanding_hostel: highestOutstandingHostel
        ? { hostel_name: highestOutstandingHostel.hostel_name, pending_dues: highestOutstandingHostel.pending_dues }
        : null,
    };

    return {
      portfolio: {
        total_revenue: aggregateRevenue,
        total_expenses: aggregateExpenses,
        total_profit: aggregateRevenue - aggregateExpenses,
        total_due: aggregateDue,
        occupancy_rate: aggregateCapacity > 0
          ? Math.round((aggregateOccupiedBeds / aggregateCapacity) * 10000) / 100
          : 0,
        active_tenants: aggregateActiveTenants,
        occupied_beds: aggregateOccupiedBeds,
        reserved_beds: aggregateReservedBeds,
        collection_rate: aggregateExpected > 0
          ? Math.round((aggregateRevenue / aggregateExpected) * 10000) / 100
          : 0,
        total_capacity: aggregateCapacity,
        vacant_beds: aggregateVacantBeds,
        move_out_open: moveOutOpen,
        pending_invites: pendingInvites,
      },
      monthly_trends,
      hostel_rankings: rankings,
      business_health_insights,
      top_performer_hostel_id: topId,
      computed_at: new Date().toISOString(),
    };
  }
}

export const portfolioPerformanceService = new PortfolioPerformanceService();
