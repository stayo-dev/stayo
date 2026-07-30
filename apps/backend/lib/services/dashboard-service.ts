import { prisma } from "../db";
import { Prisma } from "@prisma/client";
import { formatShortMonth } from "../format";
import { financialService } from "../../src/services/payments/financial-service";
import { operationalPendingInvariantHolds } from "./financial-invariants";
import { roomCapacityService } from "./room-capacity-service";

/**
 * 📊 Dashboard Service — Financial Metrics (Source of Truth)
 *
 * CRITICAL DATA INTEGRITY NOTES:
 *
 * 1. "Total Collected (This Month)" MUST use `payments.payment_date` (NOT created_at).
 *    `payment_date` is the actual date money was received.
 *
 * 2. `payment_date` is a PostgreSQL DATE column (@db.Date in Prisma).
 *    DATE has NO time component — it stores YYYY-MM-DD only.
 *    When filtering DATE columns, use plain date boundaries (day 1 to next month day 1).
 *
 * 3. Month boundaries MUST be:
 *    - startOfMonth: day 1 (INCLUSIVE via gte)
 *    - nextMonthStart: day 1 of next month (EXCLUSIVE via lt)
 *    ⚠️  NEVER use (month + 1, 0) — that gives the LAST day of current month, not first of next!
 *
 * 4. When recording payments, `payment_date` must be set to the correct calendar date
 *    in the owner's timezone (see payment-service.ts). This service only reads the stored DATE.
 */

export class DashboardService {
  private async getAgreementAlertCounts(userId: string, hostelId: string) {
    const [expiringSoon, expired] = await Promise.all([
      prisma.agreement.count({
        where: {
          hostel_id: hostelId,
          status: "EXPIRING_SOON",
          agreement_end_date: { not: null },
          hostel: { owner_id: userId },
        },
      }),
      prisma.agreement.count({
        where: {
          hostel_id: hostelId,
          status: "AGREEMENT_EXPIRED",
          agreement_end_date: { not: null },
          hostel: { owner_id: userId },
        },
      }),
    ]);
    return { expiringSoon, expired };
  }

  async getOwnerStatsShell(userId: string, hostelId: string) {
    const now = new Date();
    const utcYear = now.getUTCFullYear();
    const utcMonth = now.getUTCMonth();
    const today = new Date(Date.UTC(utcYear, utcMonth, now.getUTCDate()));
    const monthStart = new Date(Date.UTC(utcYear, utcMonth, 1, 0, 0, 0, 0));
    const nextMonthStart = new Date(Date.UTC(utcYear, utcMonth + 1, 1, 0, 0, 0, 0));
    const previousMonthStart = new Date(Date.UTC(utcYear, utcMonth - 1, 1, 0, 0, 0, 0));
    const weekEnd = new Date(today);
    weekEnd.setUTCDate(today.getUTCDate() + 7);

    const rows = await prisma.$queryRaw<Array<{
      hostel_id: string | null;
      hostel_name: string | null;
      city: string | null;
      address: string | null;
      phone: string | null;
      is_active: boolean | null;
      total_tenants: number;
      active_tenants: number;
      pending_invites: number;
      inactive_invites: number;
      joins_this_month: number;
      exits_this_month: number;
      total_rooms: number;
      total_capacity: number;
      occupied_rooms: number;
      current_revenue: number;
      previous_revenue: number;
      monthly_expenses: number;
      previous_expenses: number;
      expected_revenue: number;
      previous_expected_revenue: number;
      pending_total: number;
      overdue_total: number;
      overdue_count: number;
      unpaid_tenant_count: number;
      overdue_tenant_count: number;
      oldest_unpaid_due: Date | null;
      overdue_30_plus_count: number;
      due_today: number;
      due_this_week: number;
      move_out_open: number;
      active_dispute_count: number;
      active_dispute_amount: number;
      category_expenses: Array<{ category: string; amount: number; percentage: number; trend: number }> | null;
      room_utilization: Array<{
        id: string;
        room_no: string;
        floor: string;
        floor_name: string;
        room_type: string;
        capacity: number;
        occupied: number;
        vacant: number;
        state: string;
      }> | null;
      floor_occupancy: Array<{ floor: string; capacity: number; occupied: number; occupancy_rate: number }> | null;
    }>>`
      WITH selected_hostel AS (
        SELECT id, name, city, address, phone, is_active, status
        FROM hostels
        WHERE id = ${hostelId}::uuid
          AND owner_id = ${userId}::uuid
        LIMIT 1
      ),
      tenant_counts AS (
        SELECT
          COUNT(*)::int AS total_tenants,
          COUNT(*) FILTER (WHERE status = 'ACTIVE')::int AS active_tenants,
          COUNT(*) FILTER (WHERE status = 'INVITED')::int AS pending_invites,
          COUNT(*) FILTER (WHERE status IN ('EXPIRED', 'CANCELLED'))::int AS inactive_invites,
          COUNT(*) FILTER (WHERE status = 'ACTIVE' AND joined_on >= ${monthStart}::date AND joined_on < ${nextMonthStart}::date)::int AS joins_this_month,
          COUNT(*) FILTER (WHERE status = 'FORMER_TENANT' AND exit_date >= ${monthStart}::date AND exit_date < ${nextMonthStart}::date)::int AS exits_this_month
        FROM tenants
        WHERE owner_id = ${userId}::uuid
          AND hostel_id = ${hostelId}::uuid
      ),
      room_utilization_rows AS (
        SELECT
          r.id,
          r.room_no,
          COALESCE(f.name, CASE WHEN r.floor IS NOT NULL THEN 'Floor ' || r.floor::text ELSE 'Unassigned' END) AS floor,
          COALESCE(f.name, CASE WHEN r.floor IS NOT NULL THEN 'Floor ' || r.floor::text ELSE 'Unassigned' END) AS floor_name,
          COALESCE(r.room_type, 'Standard') AS room_type,
          COALESCE(r.capacity, 0)::int AS capacity,
          COUNT(ra.id)::int AS occupied,
          COALESCE(res.reserved, 0)::int AS reserved,
          (COUNT(ra.id) + COALESCE(res.reserved, 0))::int AS used
        FROM rooms r
        LEFT JOIN floors f ON f.id = r.floor_id
        LEFT JOIN room_allocations ra
          ON ra.room_id = r.id
         AND ra.is_active = true
         AND ra.end_date IS NULL
        LEFT JOIN LATERAL (
          SELECT COUNT(*)::int AS reserved
          FROM tenant_invitation_reservations tir
          WHERE tir.room_id = r.id
            AND tir.status = 'ACTIVE'
            AND tir.expires_at > now()
        ) res ON true
        WHERE r.hostel_id = ${hostelId}::uuid
          AND r.is_active = true
        GROUP BY r.id, r.room_no, r.floor, f.name, r.room_type, r.capacity, res.reserved
      ),
      room_summary AS (
        SELECT
          COUNT(*)::int AS total_rooms,
          COALESCE(SUM(capacity), 0)::int AS total_capacity,
          COUNT(*) FILTER (WHERE used > 0)::int AS occupied_rooms
        FROM room_utilization_rows
      ),
      floor_summary AS (
        SELECT
          floor,
          COALESCE(SUM(capacity), 0)::int AS capacity,
          COALESCE(SUM(used), 0)::int AS occupied,
          CASE WHEN COALESCE(SUM(capacity), 0) > 0
            THEN ROUND((SUM(used)::numeric / SUM(capacity)::numeric) * 100)::int
            ELSE 0
          END AS occupancy_rate
        FROM room_utilization_rows
        GROUP BY floor
      ),
      payment_month AS (
        SELECT
          COALESCE(SUM(amount_paid) FILTER (WHERE payment_date >= ${monthStart}::date AND payment_date < ${nextMonthStart}::date), 0)::float AS current_revenue,
          COALESCE(SUM(amount_paid) FILTER (WHERE payment_date >= ${previousMonthStart}::date AND payment_date < ${monthStart}::date), 0)::float AS previous_revenue
        FROM payments
        WHERE owner_id = ${userId}::uuid
          AND hostel_id = ${hostelId}::uuid
          AND payment_date >= ${previousMonthStart}::date
          AND payment_date < ${nextMonthStart}::date
      ),
      expense_month AS (
        SELECT
          COALESCE(SUM(amount) FILTER (WHERE date >= ${monthStart}::date AND date < ${nextMonthStart}::date), 0)::float AS monthly_expenses,
          COALESCE(SUM(amount) FILTER (WHERE date >= ${previousMonthStart}::date AND date < ${monthStart}::date), 0)::float AS previous_expenses
        FROM expenses
        WHERE owner_id = ${userId}::uuid
          AND hostel_id = ${hostelId}::uuid AND expense_scope = 'HOSTEL'
          AND date >= ${previousMonthStart}::date
          AND date < ${nextMonthStart}::date
      ),
      payment_by_obligation AS (
        SELECT obligation_id, COALESCE(SUM(amount_paid), 0)::float AS total_paid
        FROM payments
        WHERE owner_id = ${userId}::uuid
          AND hostel_id = ${hostelId}::uuid
        GROUP BY obligation_id
      ),
      expected_month AS (
        SELECT
          COALESCE(SUM(o.amount) FILTER (WHERE o.rent_month >= ${monthStart}::date AND o.rent_month < ${nextMonthStart}::date), 0)::float AS expected_revenue,
          COALESCE(SUM(o.amount) FILTER (WHERE o.rent_month >= ${previousMonthStart}::date AND o.rent_month < ${monthStart}::date), 0)::float AS previous_expected_revenue
        FROM rent_obligations o
        JOIN tenants t ON t.id = o.tenant_id
        WHERE o.owner_id = ${userId}::uuid
          AND o.hostel_id = ${hostelId}::uuid
          AND o.status <> 'WAIVED'
          AND o.rent_month >= ${previousMonthStart}::date
          AND o.rent_month < ${nextMonthStart}::date
      ),
      open_dues AS (
        SELECT
          o.id,
          o.tenant_id,
          o.due_date,
          GREATEST(COALESCE(o.total_amount, o.amount)::float - COALESCE(pbo.total_paid, 0), 0)::float AS remaining
        FROM rent_obligations o
        JOIN tenants t ON t.id = o.tenant_id
        LEFT JOIN payment_by_obligation pbo ON pbo.obligation_id = o.id
        WHERE o.owner_id = ${userId}::uuid
          AND o.hostel_id = ${hostelId}::uuid
          AND o.status IN ('PENDING', 'PARTIAL')
          AND GREATEST(COALESCE(o.total_amount, o.amount)::float - COALESCE(pbo.total_paid, 0), 0) > 0
      ),
      dues_summary AS (
        SELECT
          COALESCE(SUM(remaining), 0)::float AS pending_total,
          COALESCE(SUM(remaining) FILTER (WHERE due_date < ${today}::date), 0)::float AS overdue_total,
          COUNT(*) FILTER (WHERE due_date < ${today}::date)::int AS overdue_count,
          COUNT(DISTINCT tenant_id)::int AS unpaid_tenant_count,
          COUNT(DISTINCT tenant_id) FILTER (WHERE due_date < ${today}::date)::int AS overdue_tenant_count,
          MIN(due_date) FILTER (WHERE remaining > 0) AS oldest_unpaid_due,
          COUNT(*) FILTER (WHERE due_date < (${today}::date - INTERVAL '30 days'))::int AS overdue_30_plus_count,
          COALESCE(SUM(remaining) FILTER (WHERE due_date = ${today}::date), 0)::float AS due_today,
          COALESCE(SUM(remaining) FILTER (WHERE due_date >= ${today}::date AND due_date <= ${weekEnd}::date), 0)::float AS due_this_week
        FROM open_dues
      ),
      move_out_summary AS (
        SELECT
          COUNT(DISTINCT mor.id)::int AS move_out_open,
          COUNT(DISTINCT d.id)::int AS active_dispute_count,
          COALESCE(SUM(COALESCE(d.disputed_amount::float, ABS(est.net_settlement_amount::float), est.total_dues::float, 0)), 0)::float AS active_dispute_amount
        FROM move_out_requests mor
        LEFT JOIN exit_disputes d ON d.request_id = mor.id AND d.status IN ('OPEN', 'UNDER_REVIEW')
        LEFT JOIN exit_settlement_transactions est ON est.request_id = mor.id
        WHERE mor.owner_id = ${userId}::uuid
          AND mor.hostel_id = ${hostelId}::uuid
          AND mor.status NOT IN ('COMPLETED', 'REJECTED')
      ),
      category_current AS (
        SELECT category, COALESCE(SUM(amount), 0)::float AS amount
        FROM expenses
        WHERE owner_id = ${userId}::uuid
          AND hostel_id = ${hostelId}::uuid AND expense_scope = 'HOSTEL'
          AND date >= ${monthStart}::date
          AND date < ${nextMonthStart}::date
        GROUP BY category
      ),
      category_previous AS (
        SELECT category, COALESCE(SUM(amount), 0)::float AS amount
        FROM expenses
        WHERE owner_id = ${userId}::uuid
          AND hostel_id = ${hostelId}::uuid AND expense_scope = 'HOSTEL'
          AND date >= ${previousMonthStart}::date
          AND date < ${monthStart}::date
        GROUP BY category
      ),
      category_rows AS (
        SELECT
          c.category,
          c.amount,
          CASE WHEN (SELECT monthly_expenses FROM expense_month) > 0
            THEN ROUND((c.amount / (SELECT monthly_expenses FROM expense_month)) * 100)::int
            ELSE 0
          END AS percentage,
          CASE WHEN COALESCE(p.amount, 0) > 0
            THEN ROUND(((c.amount - p.amount) / p.amount) * 100)::int
            WHEN c.amount > 0 THEN 100
            ELSE 0
          END AS trend
        FROM category_current c
        LEFT JOIN category_previous p ON p.category = c.category
        ORDER BY c.amount DESC
      )
      SELECT
        sh.id AS hostel_id,
        sh.name AS hostel_name,
        sh.city,
        sh.address,
        sh.phone,
        sh.is_active,
        sh.status,
        COALESCE(tc.total_tenants, 0)::int AS total_tenants,
        COALESCE(tc.active_tenants, 0)::int AS active_tenants,
        COALESCE(tc.pending_invites, 0)::int AS pending_invites,
        COALESCE(tc.inactive_invites, 0)::int AS inactive_invites,
        COALESCE(tc.joins_this_month, 0)::int AS joins_this_month,
        COALESCE(tc.exits_this_month, 0)::int AS exits_this_month,
        COALESCE(rs.total_rooms, 0)::int AS total_rooms,
        COALESCE(rs.total_capacity, 0)::int AS total_capacity,
        COALESCE(rs.occupied_rooms, 0)::int AS occupied_rooms,
        COALESCE(pm.current_revenue, 0)::float AS current_revenue,
        COALESCE(pm.previous_revenue, 0)::float AS previous_revenue,
        COALESCE(em.monthly_expenses, 0)::float AS monthly_expenses,
        COALESCE(em.previous_expenses, 0)::float AS previous_expenses,
        COALESCE(ex.expected_revenue, 0)::float AS expected_revenue,
        COALESCE(ex.previous_expected_revenue, 0)::float AS previous_expected_revenue,
        COALESCE(ds.pending_total, 0)::float AS pending_total,
        COALESCE(ds.overdue_total, 0)::float AS overdue_total,
        COALESCE(ds.overdue_count, 0)::int AS overdue_count,
        COALESCE(ds.unpaid_tenant_count, 0)::int AS unpaid_tenant_count,
        COALESCE(ds.overdue_tenant_count, 0)::int AS overdue_tenant_count,
        ds.oldest_unpaid_due,
        COALESCE(ds.overdue_30_plus_count, 0)::int AS overdue_30_plus_count,
        COALESCE(ds.due_today, 0)::float AS due_today,
        COALESCE(ds.due_this_week, 0)::float AS due_this_week,
        COALESCE(mo.move_out_open, 0)::int AS move_out_open,
        COALESCE(mo.active_dispute_count, 0)::int AS active_dispute_count,
        COALESCE(mo.active_dispute_amount, 0)::float AS active_dispute_amount,
        COALESCE((SELECT jsonb_agg(to_jsonb(cr)) FROM category_rows cr), '[]'::jsonb) AS category_expenses,
        COALESCE((
          SELECT jsonb_agg(
            jsonb_build_object(
              'id', rur.id,
              'room_no', rur.room_no,
              'floor', rur.floor,
              'floor_name', rur.floor_name,
              'room_type', rur.room_type,
              'capacity', rur.capacity,
              'occupied', rur.occupied,
              'reserved', rur.reserved,
              'used', rur.used,
              'vacant', GREATEST(rur.capacity - rur.used, 0),
              'state', CASE WHEN rur.used >= rur.capacity THEN 'full' WHEN rur.occupied = 0 AND rur.reserved = 0 THEN 'vacant' WHEN rur.occupied = 0 THEN 'reserved' ELSE 'partial' END
            )
            ORDER BY rur.floor, rur.room_no
          )
          FROM room_utilization_rows rur
        ), '[]'::jsonb) AS room_utilization,
        COALESCE((SELECT jsonb_agg(to_jsonb(fs) ORDER BY fs.floor) FROM floor_summary fs), '[]'::jsonb) AS floor_occupancy
      FROM selected_hostel sh
      CROSS JOIN tenant_counts tc
      CROSS JOIN room_summary rs
      CROSS JOIN payment_month pm
      CROSS JOIN expense_month em
      CROSS JOIN expected_month ex
      CROSS JOIN dues_summary ds
      CROSS JOIN move_out_summary mo
      LIMIT 1
    `;

    const row = rows[0];
    if (!row) {
      throw new Error("HOSTEL_NOT_FOUND");
    }

    const totalTenants = Number(row.total_tenants || 0);
    const activeTenants = Number(row.active_tenants || 0);
    const totalCapacity = Number(row.total_capacity || 0);
    const currentRevenue = Number(row.current_revenue || 0);
    const previousRevenue = Number(row.previous_revenue || 0);
    const monthlyExpenses = Number(row.monthly_expenses || 0);
    const previousExpenses = Number(row.previous_expenses || 0);
    const expectedRevenue = Number(row.expected_revenue || 0);
    const previousExpectedRevenue = Number(row.previous_expected_revenue || 0);
    const pendingTotal = Number(row.pending_total || 0);
    const overdueTotal = Number(row.overdue_total || 0);
    const overdueCount = Number(row.overdue_tenant_count || row.overdue_count || 0);
    const activeDisputeCount = Number(row.active_dispute_count || 0);
    const activeDisputeAmount = Number(row.active_dispute_amount || 0);
    const unpaidTenantCount = operationalPendingInvariantHolds(pendingTotal, Number(row.unpaid_tenant_count || 0))
      ? Number(row.unpaid_tenant_count || 0)
      : 0;
    const agreementAlerts = await this.getAgreementAlertCounts(userId, hostelId);
    const capacityMap = await roomCapacityService.getHostelCapacityMap(hostelId, { ownerId: userId });
    const occupiedBeds = [...capacityMap.values()].reduce((sum, snapshot) => sum + Number(snapshot.occupied || 0), 0);
    const usedBeds = [...capacityMap.values()].reduce((sum, snapshot) => sum + Number(snapshot.used || 0), 0);
    const availableBeds = [...capacityMap.values()].reduce((sum, snapshot) => sum + Number(snapshot.available || 0), 0);
    const unassignedActiveTenants = Math.max(0, activeTenants - occupiedBeds);
    const occupancyRate = totalCapacity > 0 ? Math.round((usedBeds / totalCapacity) * 100) : 0;
    const netProfit = currentRevenue - monthlyExpenses;
    const previousProfit = previousRevenue - previousExpenses;
    const profitMargin = currentRevenue > 0 ? Math.round((netProfit / currentRevenue) * 100) : 0;
    const collectionRate = expectedRevenue > 0 ? Math.round((currentRevenue / expectedRevenue) * 100) : 0;
    const previousCollectionRate = previousExpectedRevenue > 0 ? Math.round((previousRevenue / previousExpectedRevenue) * 100) : 0;
    const expenseRatio = currentRevenue > 0 ? Math.round((monthlyExpenses / currentRevenue) * 100) : 0;
    const expensePerTenant = activeTenants > 0 ? Math.round(monthlyExpenses / activeTenants) : 0;
    const revenuePerOccupiedBed = occupiedBeds > 0 ? Math.round(currentRevenue / occupiedBeds) : 0;
    const avgBedRevenue = occupiedBeds > 0 ? currentRevenue / occupiedBeds : 0;
    const vacancyLossEstimate = Math.round(availableBeds * avgBedRevenue);
    const revenueTrend = previousRevenue > 0 ? Math.round(((currentRevenue - previousRevenue) / previousRevenue) * 100) : currentRevenue > 0 ? 100 : 0;
    const profitTrend = previousProfit !== 0 ? Math.round(((netProfit - previousProfit) / Math.abs(previousProfit)) * 100) : netProfit > 0 ? 100 : 0;
    const expenseGrowth = previousExpenses > 0 ? Math.round(((monthlyExpenses - previousExpenses) / previousExpenses) * 100) : monthlyExpenses > 0 ? 100 : 0;
    const tenantChurnRate = activeTenants > 0 ? Math.round((Number(row.exits_this_month || 0) / activeTenants) * 100) : 0;
    const topExpenseCategory = row.category_expenses?.[0] || null;
    const fixedCategories = new Set(["Internet", "Security", "Staff Salary", "Salary"]);
    const fixedExpenses = (row.category_expenses || []).filter((c) => fixedCategories.has(c.category)).reduce((sum, c) => sum + Number(c.amount || 0), 0);
    const fixedCostRatio = monthlyExpenses > 0 ? Math.round((fixedExpenses / monthlyExpenses) * 100) : 0;

    let operationalScore = 100;
    operationalScore -= Math.max(0, 90 - occupancyRate) * 0.5;
    operationalScore -= Math.max(0, 95 - collectionRate) * 0.35;
    operationalScore -= Math.max(0, expenseRatio - 35) * 0.45;
    operationalScore -= Math.max(0, 20 - profitMargin) * 0.6;
    operationalScore -= Math.min(20, overdueCount * 4);
    operationalScore -= Math.min(12, tenantChurnRate * 1.5);
    operationalScore = Math.max(0, Math.min(100, Math.round(operationalScore)));
    const operationalState = operationalScore >= 85 ? "Excellent" : operationalScore >= 70 ? "Healthy" : operationalScore >= 45 ? "At Risk" : "Critical";
    const profitabilityStatus = profitMargin >= 30 && pendingTotal < currentRevenue * 0.15 && occupancyRate >= 85 && expenseRatio <= 35
      ? "Highly Profitable"
      : profitMargin >= 18 && occupancyRate >= 70
        ? "Stable"
        : profitMargin >= 0 && operationalScore >= 45
          ? "Attention Needed"
          : "Critical";

    const duesAging = {
      total_dues: pendingTotal,
      overdue_dues: overdueTotal,
      due_today: Number(row.due_today || 0),
      due_this_week: Number(row.due_this_week || 0),
      oldest_unpaid_due: row.oldest_unpaid_due || null,
      overdue_30_plus_count: Number(row.overdue_30_plus_count || 0),
    };

    const alerts = [
      ...(agreementAlerts.expired > 0 ? [{
        severity: "critical",
        title: `${agreementAlerts.expired} expired agreement${agreementAlerts.expired === 1 ? "" : "s"}`,
        impact: "Occupied tenants may be staying without a valid current contract",
        action: "Review agreement renewals",
        cta: "Open tenants",
      }] : []),
      ...(agreementAlerts.expiringSoon > 0 ? [{
        severity: "warning",
        title: `${agreementAlerts.expiringSoon} agreement${agreementAlerts.expiringSoon === 1 ? "" : "s"} expiring soon`,
        impact: "Renew before contract expiry",
        action: "Follow up with tenants",
        cta: "Open tenants",
      }] : []),
      ...(activeDisputeCount > 0 ? [{
        severity: "critical",
        title: `${activeDisputeCount} settlement dispute${activeDisputeCount === 1 ? "" : "s"} open`,
        impact: `₹${activeDisputeAmount.toLocaleString("en-IN")} at risk`,
        action: "Review tenant dispute before closing move-out",
        cta: "Open move-outs",
      }] : []),
      ...(overdueTotal > 0 ? [{
        severity: overdueCount > 2 || duesAging.overdue_30_plus_count > 0 ? "critical" : "warning",
        title: `${overdueCount} tenant${overdueCount === 1 ? "" : "s"} overdue`,
        impact: `${overdueTotal.toLocaleString("en-IN")} pending collection risk`,
        action: "Collect or send reminder today",
        cta: "Review dues",
      }] : []),
      ...(occupancyRate < 70 ? [{
        severity: occupancyRate < 60 ? "critical" : "warning",
        title: "Low occupancy pressure",
        impact: `${availableBeds} vacant beds may cost ₹${vacancyLossEstimate.toLocaleString("en-IN")}`,
        action: "Push room filling or adjust pricing",
        cta: "Open rooms",
      }] : []),
      ...(unassignedActiveTenants > 0 ? [{
        severity: "warning",
        title: `${unassignedActiveTenants} active tenant${unassignedActiveTenants === 1 ? "" : "s"} need room allocation`,
        impact: "These tenants are active but not occupying a room",
        action: "Assign rooms before trusting occupancy reports",
        cta: "Open tenants",
      }] : []),
      ...(expenseRatio > 45 ? [{
        severity: expenseRatio > 60 ? "critical" : "warning",
        title: "Expenses consuming revenue",
        impact: `${expenseRatio}% of collections are going to operations`,
        action: "Check top expense categories",
        cta: "Open expenses",
      }] : []),
      ...(Number(row.pending_invites || 0) > 0 ? [{
        severity: "info",
        title: `${row.pending_invites} onboarding pending`,
        impact: "Invited tenants have not completed activation",
        action: "Follow up before rooms stay vacant",
        cta: "Open tenants",
      }] : []),
      ...(Number(row.move_out_open || 0) > 0 ? [{
        severity: "warning",
        title: `${row.move_out_open} move-out request${Number(row.move_out_open) === 1 ? "" : "s"} open`,
        impact: "Upcoming vacancy or settlement work",
        action: "Resolve inspection and replacement plan",
        cta: "Open move-outs",
      }] : []),
    ].slice(0, 6);

    return {
      hostel: {
        id: row.hostel_id || hostelId,
        name: row.hostel_name || "Hostel",
        location: row.city || row.address || "",
        phone: row.phone || null,
        status: row.status === "ACTIVE" ? "Active" : row.status === "INACTIVE" ? "Inactive" : "Archived",
      },
      total_rooms: Number(row.total_rooms || 0),
      occupied_rooms: Number(row.occupied_rooms || 0),
      total_tenants: totalTenants,
      active_tenants: activeTenants,
      occupied_beds: occupiedBeds,
      reserved_beds: Math.max(0, usedBeds - occupiedBeds),
      unassigned_active_tenants: unassignedActiveTenants,
      total_capacity: totalCapacity,
      vacant_beds: availableBeds,
      occupancy_rate: occupancyRate,
      revenue: currentRevenue,
      total_revenue: currentRevenue,
      monthly_revenue: currentRevenue,
      monthly_expenses: monthlyExpenses,
      expenses_this_month: monthlyExpenses,
      rent_collected_this_month: currentRevenue,
      pending_dues: pendingTotal,
      overdue_amount: overdueTotal,
      overdue_count: overdueCount,
      overdue_tenants: overdueCount,
      unpaid_tenant_count: unpaidTenantCount,
      expected_revenue: expectedRevenue,
      collection_rate: collectionRate,
      net_profit: netProfit,
      profit_margin: profitMargin,
      expense_revenue_ratio: expenseRatio,
      expense_per_tenant: expensePerTenant,
      revenue_per_occupied_bed: revenuePerOccupiedBed,
      vacancy_loss_estimate: vacancyLossEstimate,
      tenant_churn_rate: tenantChurnRate,
      reminder_conversion_rate: 0,
      operational_score: operationalScore,
      operational_state: operationalState,
      profitability_status: profitabilityStatus,
      intelligence: {
        health: {
          score: operationalScore,
          state: operationalState,
          profitability_status: profitabilityStatus,
          occupancy_state: occupancyRate >= 90 ? "Healthy" : occupancyRate >= 60 ? "Moderate" : "Dangerous",
          profit_state: netProfit < 0 ? "loss" : profitMargin >= 20 ? "healthy" : "unstable",
        },
        kpis: {
          occupancy: {
            value: occupancyRate,
            occupied_beds: occupiedBeds,
            reserved_beds: Math.max(0, usedBeds - occupiedBeds),
            vacant_beds: availableBeds,
            unassigned_active_tenants: unassignedActiveTenants,
            trend: 0,
            insight: `${availableBeds} vacant beds need filling`,
          },
          revenue: {
            collected: currentRevenue,
            expected: expectedRevenue,
            collection_rate: collectionRate,
            trend: revenueTrend,
            insight: `₹${pendingTotal.toLocaleString("en-IN")} pending from ${unpaidTenantCount} tenants`,
          },
          profit: {
            amount: netProfit,
            margin: profitMargin,
            trend: profitTrend,
            insight: profitTrend < 0 ? `Profit trend down ${Math.abs(profitTrend)}%` : `Profit trend up ${profitTrend}%`,
          },
          dues: {
            pending: pendingTotal,
            overdue_tenants: overdueCount,
            oldest_unpaid_due: row.oldest_unpaid_due || null,
            insight: `${duesAging.overdue_30_plus_count} tenants overdue beyond 30 days`,
          },
          expenses: {
            amount: monthlyExpenses,
            ratio: expenseRatio,
            top_category: topExpenseCategory,
            insight: topExpenseCategory?.trend > 30 ? `${topExpenseCategory.category} increased ${topExpenseCategory.trend}%` : "Expenses are within tracked range",
          },
          tenant_stability: {
            move_out_requests: Number(row.move_out_open || 0),
            active_settlement_disputes: activeDisputeCount,
            settlement_dispute_amount: activeDisputeAmount,
            new_joins: Number(row.joins_this_month || 0),
            exits: Number(row.exits_this_month || 0),
            churn_rate: tenantChurnRate,
            insight: tenantChurnRate > 10 ? "High tenant churn detected" : "Tenant movement looks stable",
          },
        },
        revenue: {
          trend: revenueTrend,
          collection_efficiency: {
            collection_rate: collectionRate,
            trend: collectionRate - previousCollectionRate,
            average_payment_delay_days: 0,
            late_fee_collected: 0,
            pending_amount: pendingTotal,
          },
          revenue_per_occupied_bed: revenuePerOccupiedBed,
        },
        occupancy: {
          room_utilization: row.room_utilization || [],
          summary: {
            full_rooms: (row.room_utilization || []).filter((r) => r.state === "full").length,
            partial_rooms: (row.room_utilization || []).filter((r) => r.state === "partial").length,
            vacant_rooms: (row.room_utilization || []).filter((r) => r.state === "vacant").length,
          },
          floor_occupancy: row.floor_occupancy || [],
          vacancy_risk: {
            vacant_beds: availableBeds,
            vacancy_loss_estimate: vacancyLossEstimate,
            insight: occupancyRate < 70 ? "Occupancy is dragging profitability" : "Occupancy is supporting revenue",
          },
          occupancy_vs_profit: [],
        },
        dues: {
          summary: duesAging,
          high_risk_tenants: [],
          reminder_conversion: {
            sent: 0,
            conversions: 0,
            conversion_rate: 0,
            best_channel: null,
          },
          low_behavior_scores: [],
        },
        expenses: {
          categories: (row.category_expenses || []).slice(0, 6),
          growth: expenseGrowth,
          fixed_variable_ratio: fixedCostRatio,
          expense_per_tenant: expensePerTenant,
          anomalies: (row.category_expenses || []).filter((c) => c.trend > 35).slice(0, 3),
        },
        tenant_movement: {
          recent_joins: Number(row.joins_this_month || 0),
          move_out_requests: Number(row.move_out_open || 0),
          active_settlement_disputes: activeDisputeCount,
          settlement_dispute_amount: activeDisputeAmount,
          exits_this_month: Number(row.exits_this_month || 0),
          pending_onboarding: Number(row.pending_invites || 0),
          inactive_invitations: Number(row.inactive_invites || 0),
        },
        payment_attempts: {
          total: 0,
          success: 0,
          failed: 0,
          pending_verification: 0,
          abandoned: 0,
          upi_failure_rate: 0,
        },
        alerts,
        recent_activity: [],
      },
    };
  }

  async getOwnerStatsActivity(userId: string, hostelId: string) {
    const rows = await prisma.$queryRaw<Array<{ activity: any[] }>>`
      WITH recent_payments AS (
        SELECT
          'payment' AS type,
          (COALESCE(pr.name, 'Tenant') || ' paid ₹' || ROUND(p.amount_paid)::text) AS title,
          p.payment_method AS detail,
          p.payment_date::timestamptz AS date
        FROM payments p
        LEFT JOIN tenants t ON t.id = p.tenant_id
        LEFT JOIN profiles pr ON pr.id = t.profile_id
        WHERE p.owner_id = ${userId}::uuid AND p.hostel_id = ${hostelId}::uuid
        ORDER BY p.payment_date DESC
        LIMIT 5
      ),
      recent_expenses AS (
        SELECT
          'expense' AS type,
          (category || ' expense added') AS title,
          (title || ' · ₹' || ROUND(amount)::text) AS detail,
          date::timestamptz AS date
        FROM expenses
        WHERE owner_id = ${userId}::uuid AND hostel_id = ${hostelId}::uuid
        ORDER BY date DESC
        LIMIT 5
      ),
      recent_moveouts AS (
        SELECT
          'moveout' AS type,
          (COALESCE(pr.name, 'Tenant') || ' move-out ' || lower(m.status::text)) AS title,
          COALESCE(m.reason_text, m.reason::text, 'Move-out request') AS detail,
          m.created_at AS date
        FROM move_out_requests m
        LEFT JOIN tenants t ON t.id = m.tenant_id
        LEFT JOIN profiles pr ON pr.id = t.profile_id
        WHERE m.owner_id = ${userId}::uuid AND m.hostel_id = ${hostelId}::uuid
        ORDER BY m.created_at DESC
        LIMIT 5
      ),
      recent_allocations AS (
        SELECT
          'allocation' AS type,
          trim(COALESCE(pr.name, 'Tenant') || ' allocated room ' || COALESCE(r.room_no, '')) AS title,
          'Room allocation' AS detail,
          ra.created_at AS date
        FROM room_allocations ra
        LEFT JOIN rooms r ON r.id = ra.room_id
        LEFT JOIN tenants t ON t.id = ra.tenant_id
        LEFT JOIN profiles pr ON pr.id = t.profile_id
        WHERE ra.hostel_id = ${hostelId}::uuid
        ORDER BY ra.created_at DESC
        LIMIT 5
      ),
      unioned AS (
        SELECT * FROM recent_payments
        UNION ALL SELECT * FROM recent_expenses
        UNION ALL SELECT * FROM recent_moveouts
        UNION ALL SELECT * FROM recent_allocations
      )
      SELECT COALESCE(jsonb_agg(to_jsonb(unioned) ORDER BY date DESC), '[]'::jsonb) AS activity
      FROM (SELECT * FROM unioned ORDER BY date DESC LIMIT 12) unioned
    `;

    return {
      recent_activity: rows[0]?.activity || [],
    };
  }

  async getOwnerStatsAnalytics(userId: string, hostelId: string) {
    const now = new Date();
    const utcYear = now.getUTCFullYear();
    const utcMonth = now.getUTCMonth();
    const monthStart = new Date(Date.UTC(utcYear, utcMonth, 1, 0, 0, 0, 0));
    const nextMonthStart = new Date(Date.UTC(utcYear, utcMonth + 1, 1, 0, 0, 0, 0));
    const sixMonthStart = new Date(Date.UTC(utcYear, utcMonth - 5, 1, 0, 0, 0, 0));

    const rows = await prisma.$queryRaw<Array<{
      monthly_trend: Array<{ month: string; expected: number; collected: number; expenses: number; profit: number }> | null;
      occupancy_vs_profit: Array<{ date: Date; occupancy: number; profit: number }> | null;
      reminder_sent: number;
      reminder_conversions: number;
      best_channel: string | null;
      attempt_total: number;
      attempt_success: number;
      attempt_failed: number;
      attempt_pending_verification: number;
      attempt_abandoned: number;
    }>>`
      WITH months AS (
        SELECT generate_series(date_trunc('month', ${sixMonthStart}::date), date_trunc('month', ${monthStart}::date), interval '1 month')::date AS month_start
      ),
      expected AS (
        SELECT date_trunc('month', rent_month)::date AS month_start, COALESCE(SUM(amount), 0)::float AS amount
        FROM rent_obligations o
        JOIN tenants t ON t.id = o.tenant_id
        WHERE o.owner_id = ${userId}::uuid
          AND o.hostel_id = ${hostelId}::uuid
          AND o.status <> 'WAIVED'
          AND o.rent_month >= ${sixMonthStart}::date
        GROUP BY 1
      ),
      collected AS (
        SELECT date_trunc('month', payment_date)::date AS month_start, COALESCE(SUM(amount_paid), 0)::float AS amount
        FROM payments
        WHERE owner_id = ${userId}::uuid
          AND hostel_id = ${hostelId}::uuid
          AND payment_date >= ${sixMonthStart}::date
        GROUP BY 1
      ),
      spent AS (
        SELECT date_trunc('month', date)::date AS month_start, COALESCE(SUM(amount), 0)::float AS amount
        FROM expenses
        WHERE owner_id = ${userId}::uuid
          AND hostel_id = ${hostelId}::uuid AND expense_scope = 'HOSTEL'
          AND date >= ${sixMonthStart}::date
        GROUP BY 1
      ),
      trend_rows AS (
        SELECT
          to_char(m.month_start, 'Mon') AS month,
          COALESCE(e.amount, 0)::float AS expected,
          COALESCE(c.amount, 0)::float AS collected,
          COALESCE(s.amount, 0)::float AS expenses,
          (COALESCE(c.amount, 0) - COALESCE(s.amount, 0))::float AS profit,
          m.month_start
        FROM months m
        LEFT JOIN expected e ON e.month_start = m.month_start
        LEFT JOIN collected c ON c.month_start = m.month_start
        LEFT JOIN spent s ON s.month_start = m.month_start
      ),
      reminder_summary AS (
        SELECT
          COUNT(*)::int AS sent,
          COUNT(*) FILTER (WHERE converted_to_payment = true)::int AS conversions
        FROM reminder_logs
        WHERE hostel_id = ${hostelId}::uuid
          AND sent_at >= ${monthStart}::date
          AND sent_at < ${nextMonthStart}::date
      ),
      reminder_channel AS (
        SELECT channel
        FROM reminder_logs
        WHERE hostel_id = ${hostelId}::uuid
          AND sent_at >= ${monthStart}::date
          AND sent_at < ${nextMonthStart}::date
        GROUP BY channel
        ORDER BY COUNT(*) DESC
        LIMIT 1
      ),
      attempt_summary AS (
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE status = 'SUCCESS')::int AS success,
          COUNT(*) FILTER (WHERE status = 'FAILED')::int AS failed,
          COUNT(*) FILTER (WHERE status IN ('PENDING_VERIFICATION', 'PENDING_MANUAL_CONFIRMATION'))::int AS pending_verification,
          COUNT(*) FILTER (WHERE status = 'EXPIRED')::int AS abandoned
        FROM payment_attempts
        WHERE owner_id = ${userId}::uuid
          AND hostel_id = ${hostelId}::uuid
          AND created_at >= ${monthStart}::date
          AND created_at < ${nextMonthStart}::date
      )
      SELECT
        COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'month', month,
            'expected', expected,
            'collected', collected,
            'expenses', expenses,
            'profit', profit
          ) ORDER BY month_start)
          FROM trend_rows
        ), '[]'::jsonb) AS monthly_trend,
        COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'date', snapshot_date,
            'occupancy', COALESCE(occupancy_rate, 0),
            'profit', COALESCE(profit, 0)
          ) ORDER BY snapshot_date)
          FROM (
            SELECT snapshot_date, occupancy_rate, profit
            FROM hostel_daily_snapshots
            WHERE hostel_id = ${hostelId}::uuid
              AND snapshot_date >= ${sixMonthStart}::date
            ORDER BY snapshot_date ASC
            LIMIT 180
          ) snapshots
        ), '[]'::jsonb) AS occupancy_vs_profit,
        COALESCE(rs.sent, 0)::int AS reminder_sent,
        COALESCE(rs.conversions, 0)::int AS reminder_conversions,
        rc.channel AS best_channel,
        COALESCE(ats.total, 0)::int AS attempt_total,
        COALESCE(ats.success, 0)::int AS attempt_success,
        COALESCE(ats.failed, 0)::int AS attempt_failed,
        COALESCE(ats.pending_verification, 0)::int AS attempt_pending_verification,
        COALESCE(ats.abandoned, 0)::int AS attempt_abandoned
      FROM reminder_summary rs
      CROSS JOIN attempt_summary ats
      LEFT JOIN reminder_channel rc ON true
      LIMIT 1
    `;

    const row = rows[0];
    const reminderSent = Number(row?.reminder_sent || 0);
    const reminderConversions = Number(row?.reminder_conversions || 0);
    const attemptsTotal = Number(row?.attempt_total || 0);
    const decisiveAttempts = attemptsTotal - Number(row?.attempt_pending_verification || 0);
    const upiFailureRate = decisiveAttempts > 0 ? Math.round((Number(row?.attempt_failed || 0) / decisiveAttempts) * 100) : 0;

    return {
      revenue: {
        trend: row?.monthly_trend || [],
      },
      occupancy: {
        occupancy_vs_profit: row?.occupancy_vs_profit || [],
      },
      dues: {
        reminder_conversion: {
          sent: reminderSent,
          conversions: reminderConversions,
          conversion_rate: reminderSent > 0 ? Math.round((reminderConversions / reminderSent) * 100) : 0,
          best_channel: row?.best_channel || null,
        },
      },
      payment_attempts: {
        total: attemptsTotal,
        success: Number(row?.attempt_success || 0),
        failed: Number(row?.attempt_failed || 0),
        pending_verification: Number(row?.attempt_pending_verification || 0),
        abandoned: Number(row?.attempt_abandoned || 0),
        upi_failure_rate: upiFailureRate,
      },
    };
  }

  async getOwnerStats(userId: string, hostelId: string) {
    // Use UTC month boundaries for DATE column filtering.
    //
    // payments.payment_date is @db.Date (PostgreSQL DATE, no time component).
    // Prisma sends Date objects to PostgreSQL which casts them to DATE (YYYY-MM-DD).
    // We use UTC-constructed dates so the YYYY-MM-DD extracted is predictable.
    //
    // Example for May 2026:
    //   monthStart = 2026-05-01T00:00:00Z → PostgreSQL DATE = '2026-05-01'
    //   nextMonthStart = 2026-06-01T00:00:00Z → PostgreSQL DATE = '2026-06-01'
    //   Filter: payment_date >= '2026-05-01' AND payment_date < '2026-06-01'
    //   This correctly includes May 1–31 and excludes June onward.
    const now = new Date();
    const utcYear = now.getUTCFullYear();
    const utcMonth = now.getUTCMonth();
    const today = new Date();

    // ✅ FIXED: Use (utcMonth + 1, 1) for first day of next month.
    // ❌ BUG WAS: (utcMonth + 1, 0) = last day of CURRENT month, excluding final day's payments.
    const monthStart = new Date(Date.UTC(utcYear, utcMonth, 1, 0, 0, 0, 0));
    const nextMonthStart = new Date(Date.UTC(utcYear, utcMonth + 1, 1, 0, 0, 0, 0));
    const previousMonthStart = new Date(Date.UTC(utcYear, utcMonth - 1, 1, 0, 0, 0, 0));
    const sixMonthStart = new Date(Date.UTC(utcYear, utcMonth - 5, 1, 0, 0, 0, 0));
    const weekEnd = new Date(today);
    weekEnd.setDate(today.getDate() + 7);

    const hostelRoomFilter = Prisma.sql`AND h.id = ${hostelId}::uuid`;
    const hostelPaymentFilter = { hostel_id: hostelId };

    // ✅ Use count()+aggregate instead of findMany — avoids fetching full rows for JS-side counting
    const [totalTenants, activeTenants, roomStats, payments, costs, occupiedRoomCount] = await Promise.all([
      prisma.tenants.count({ where: { owner_id: userId, hostel_id: hostelId } }),
      prisma.tenants.count({ where: { owner_id: userId, status: "ACTIVE", hostel_id: hostelId } }),
      prisma.$queryRaw<{ total_rooms: number; total_capacity: number }[]>`
        SELECT COUNT(r.id)::int AS total_rooms, COALESCE(SUM(r.capacity), 0)::int AS total_capacity
        FROM rooms r JOIN hostels h ON h.id = r.hostel_id
        WHERE h.owner_id = ${userId}::uuid AND r.is_active = true
        ${hostelRoomFilter}
      `,
      // ✅ FIXED: Use payment_date (actual payment date, source of truth)
      // ✅ FIXED: Use nextMonthStart (day 1 of next month, exclusive upper bound)
      prisma.payments.aggregate({
        where: {
          owner_id: userId,
          payment_date: { gte: monthStart, lt: nextMonthStart },
          ...hostelPaymentFilter,
        },
        _sum: { amount_paid: true },
      }),
      prisma.expenses.aggregate({
        where: {
          owner_id: userId,
          date: { gte: monthStart, lt: nextMonthStart },
          ...hostelPaymentFilter,
        },
        _sum: { amount: true },
      }),
      prisma.$queryRaw<Array<{ count: number }>>`
        SELECT COUNT(*)::int AS count
        FROM rooms r
        WHERE r.hostel_id = ${hostelId}::uuid
          AND r.is_active = true
          AND (
            EXISTS (
              SELECT 1
              FROM room_allocations ra
              JOIN tenants t ON t.id = ra.tenant_id
              WHERE ra.room_id = r.id
                AND ra.is_active = true
                AND ra.end_date IS NULL
                AND t.status = 'ACTIVE'
            )
            OR EXISTS (
              SELECT 1
              FROM tenant_invitation_reservations tir
              WHERE tir.room_id = r.id
                AND tir.status = 'ACTIVE'
                AND tir.expires_at > now()
            )
          )
      `,
    ]);

    const totalCapacity = Number(roomStats[0]?.total_capacity ?? 0);
    const capacityMap = await roomCapacityService.getHostelCapacityMap(hostelId, { ownerId: userId });
    const occupiedBeds = [...capacityMap.values()].reduce((sum, snapshot) => sum + Number(snapshot.occupied || 0), 0);
    const usedBeds = [...capacityMap.values()].reduce((sum, snapshot) => sum + Number(snapshot.used || 0), 0);
    const availableBeds = [...capacityMap.values()].reduce((sum, snapshot) => sum + Number(snapshot.available || 0), 0);
    const unassignedActiveTenants = Math.max(0, Number(activeTenants || 0) - occupiedBeds);
    const currentRevenue = Number(payments._sum.amount_paid || 0);
    const monthlyExpenses = Number(costs?._sum?.amount || 0);
    const occupancyRate = totalCapacity > 0 ? Math.round((usedBeds / totalCapacity) * 100) : 0;

    // Pending dues calculation — single DB aggregate instead of findMany+include+JS loop.
    // Logic is identical: remaining = amount - SUM(payments); overdue = due_date < today.
    // due_date is @db.Date — compare against UTC midnight of today for DATE-to-DATE clean match.
    // Operational dues — ACTIVE tenants only (canonical via financialService)
    const dues = await financialService.getOperationalDues(userId, hostelId);
    const pendingTotal = dues.pending_total;
    const overdueTotal = dues.overdue_total;
    const overdueCount = dues.overdue_tenant_count;
    const unpaidTenantCount = operationalPendingInvariantHolds(pendingTotal, dues.unpaid_tenant_count)
      ? dues.unpaid_tenant_count
      : 0;

    const oldestUnpaidWhere = { owner_id: userId, hostel_id: hostelId, status: { in: ["PENDING", "PARTIAL"] } };
    const oldestUnpaidPromise = prisma.rent_obligations.findFirst({
      where: oldestUnpaidWhere,
      orderBy: { due_date: "asc" },
      select: { due_date: true },
    });

    const [
      hostelRaw,
      previousPayments,
      currentExpected,
      previousExpected,
      previousCosts,
      rooms,
      categoryExpenses,
      previousCategoryExpenses,
      obligationsRisk,
      oldestUnpaid,
      dueTodayAgg,
      dueWeekAgg,
      moveOutOpen,
      activeDisputeRows,
      joinsThisMonth,
      exitsThisMonth,
      pendingInvites,
      inactiveInvites,
      remindersSent,
      reminderConversions,
      reminderChannels,
      highRiskScores,
      monthlyRows,
      occupancyProfitRows,
      recentPayments,
      recentExpenses,
      recentMoveOuts,
      recentAllocations,
      paymentAttemptStats,
    ] = await Promise.all([
      prisma.hostels.findUnique({
        where: { id: hostelId },
        select: { id: true, name: true, city: true, state: true, address: true, phone: true, is_active: true, status: true, owner_id: true },
      }),
      prisma.payments.aggregate({
        where: { owner_id: userId, hostel_id: hostelId, payment_date: { gte: previousMonthStart, lt: monthStart } },
        _sum: { amount_paid: true },
      }),
      prisma.rent_obligations.aggregate({
        where: { owner_id: userId, hostel_id: hostelId, rent_month: { gte: monthStart, lt: nextMonthStart }, status: { not: "WAIVED" } },
        _sum: { total_amount: true },
      }),
      prisma.rent_obligations.aggregate({
        where: { owner_id: userId, hostel_id: hostelId, rent_month: { gte: previousMonthStart, lt: monthStart }, status: { not: "WAIVED" } },
        _sum: { total_amount: true },
      }),
      prisma.expenses.aggregate({
        where: { owner_id: userId, hostel_id: hostelId, date: { gte: previousMonthStart, lt: monthStart } },
        _sum: { amount: true },
      }),
      prisma.rooms.findMany({
        where: { hostel_id: hostelId, is_active: true },
        select: {
          id: true,
          room_no: true,
          capacity: true,
          room_type: true,
          floor: true,
          floor_ref: { select: { id: true, name: true } },
          room_allocations: {
            where: { is_active: true, end_date: null },
            select: { id: true, start_date: true, tenant_id: true },
          },
        },
        orderBy: [{ floor: "asc" }, { room_no: "asc" }],
      }),
      prisma.expenses.groupBy({
        by: ["category"],
        where: { owner_id: userId, hostel_id: hostelId, date: { gte: monthStart, lt: nextMonthStart } },
        _sum: { amount: true },
      }),
      prisma.expenses.groupBy({
        by: ["category"],
        where: { owner_id: userId, hostel_id: hostelId, date: { gte: previousMonthStart, lt: monthStart } },
        _sum: { amount: true },
      }),
      prisma.rent_obligations.findMany({
        where: { owner_id: userId, hostel_id: hostelId, status: { in: ["PENDING", "PARTIAL"] } },
        include: { tenants: { include: { profiles: { select: { name: true, phone: true } } } }, payments: { select: { amount_paid: true } } },
        orderBy: [{ due_date: "asc" }, { total_amount: "desc" }],
        take: 8,
      }),
      oldestUnpaidPromise,
      prisma.rent_obligations.aggregate({
        where: { owner_id: userId, hostel_id: hostelId, due_date: today, status: { in: ["PENDING", "PARTIAL"] } },
        _sum: { total_amount: true },
      }),
      prisma.rent_obligations.aggregate({
        where: { owner_id: userId, hostel_id: hostelId, due_date: { gte: today, lte: weekEnd }, status: { in: ["PENDING", "PARTIAL"] } },
        _sum: { total_amount: true },
      }),
      prisma.move_out_requests.count({
        where: { owner_id: userId, hostel_id: hostelId, status: { notIn: ["COMPLETED", "REJECTED"] } },
      }),
      prisma.$queryRaw<Array<{ active_dispute_count: number; active_dispute_amount: number }>>`
        SELECT
          COUNT(DISTINCT d.id)::int AS active_dispute_count,
          COALESCE(SUM(COALESCE(d.disputed_amount::float, ABS(est.net_settlement_amount::float), est.total_dues::float, 0)), 0)::float AS active_dispute_amount
        FROM exit_disputes d
        JOIN move_out_requests mor ON mor.id = d.request_id
        LEFT JOIN exit_settlement_transactions est ON est.request_id = mor.id
        WHERE mor.owner_id = ${userId}::uuid
          AND mor.hostel_id = ${hostelId}::uuid
          AND mor.status::text NOT IN ('COMPLETED', 'REJECTED')
          AND d.status IN ('OPEN', 'UNDER_REVIEW')
      `,
      prisma.tenants.count({
        where: { owner_id: userId, hostel_id: hostelId, status: "ACTIVE", joined_on: { gte: monthStart, lt: nextMonthStart } },
      }),
      prisma.tenants.count({
        where: { owner_id: userId, hostel_id: hostelId, status: "FORMER_TENANT", exit_date: { gte: monthStart, lt: nextMonthStart } },
      }),
      prisma.tenants.count({ where: { owner_id: userId, hostel_id: hostelId, status: "INVITED" } }),
      prisma.tenants.count({ where: { owner_id: userId, hostel_id: hostelId, status: { in: ["EXPIRED", "CANCELLED"] } } }),
      prisma.reminder_logs.count({
        where: { hostel_id: hostelId, sent_at: { gte: monthStart, lt: nextMonthStart } },
      }),
      prisma.reminder_logs.count({
        where: { hostel_id: hostelId, sent_at: { gte: monthStart, lt: nextMonthStart }, converted_to_payment: true },
      }),
      prisma.reminder_logs.groupBy({
        by: ["channel"],
        where: { hostel_id: hostelId, sent_at: { gte: monthStart, lt: nextMonthStart } },
        _count: { id: true },
      }),
      prisma.tenant_behavior_scores.findMany({
        where: { tenants: { owner_id: userId, hostel_id: hostelId } },
        include: { tenants: { include: { profiles: { select: { name: true, phone: true } } } } },
        orderBy: { score: "asc" },
        take: 5,
      }),
      prisma.$queryRaw<Array<{ month: string; expected: number; collected: number; expenses: number; profit: number }>>`
        WITH months AS (
          SELECT generate_series(date_trunc('month', ${sixMonthStart}::date), date_trunc('month', ${monthStart}::date), interval '1 month')::date AS month_start
        ),
        expected AS (
          SELECT date_trunc('month', rent_month)::date AS month_start, COALESCE(SUM(total_amount), 0)::numeric AS amount
          FROM rent_obligations
          WHERE owner_id = ${userId}::uuid AND hostel_id = ${hostelId}::uuid AND status <> 'WAIVED' AND rent_month >= ${sixMonthStart}::date
          GROUP BY 1
        ),
        collected AS (
          SELECT date_trunc('month', payment_date)::date AS month_start, COALESCE(SUM(amount_paid), 0)::numeric AS amount
          FROM payments
          WHERE owner_id = ${userId}::uuid AND hostel_id = ${hostelId}::uuid AND payment_date >= ${sixMonthStart}::date
          GROUP BY 1
        ),
        spent AS (
          SELECT date_trunc('month', date)::date AS month_start, COALESCE(SUM(amount), 0)::numeric AS amount
          FROM expenses
          WHERE owner_id = ${userId}::uuid AND hostel_id = ${hostelId}::uuid AND date >= ${sixMonthStart}::date
          GROUP BY 1
        )
        SELECT to_char(m.month_start, 'Mon') AS month,
          COALESCE(e.amount, 0)::float AS expected,
          COALESCE(c.amount, 0)::float AS collected,
          COALESCE(s.amount, 0)::float AS expenses,
          (COALESCE(c.amount, 0) - COALESCE(s.amount, 0))::float AS profit
        FROM months m
        LEFT JOIN expected e ON e.month_start = m.month_start
        LEFT JOIN collected c ON c.month_start = m.month_start
        LEFT JOIN spent s ON s.month_start = m.month_start
        ORDER BY m.month_start ASC
      `,
      prisma.hostel_daily_snapshots.findMany({
        where: { hostel_id: hostelId, snapshot_date: { gte: sixMonthStart } },
        select: { snapshot_date: true, occupancy_rate: true, profit: true, collected_revenue: true, expenses: true },
        orderBy: { snapshot_date: "asc" },
        take: 180,
      }),
      prisma.payments.findMany({
        where: { owner_id: userId, hostel_id: hostelId },
        include: { tenants: { include: { profiles: { select: { name: true } } } } },
        orderBy: { payment_date: "desc" },
        take: 5,
      }),
      prisma.expenses.findMany({
        where: { owner_id: userId, hostel_id: hostelId },
        orderBy: { date: "desc" },
        take: 5,
      }),
      prisma.move_out_requests.findMany({
        where: { owner_id: userId, hostel_id: hostelId },
        include: { tenant: { include: { profiles: { select: { name: true } } } } },
        orderBy: { created_at: "desc" },
        take: 5,
      }),
      prisma.roomAllocation.findMany({
        where: { hostel_id: hostelId },
        include: { room: { select: { room_no: true } }, tenant: { include: { profiles: { select: { name: true } } } } },
        orderBy: { created_at: "desc" },
        take: 5,
      }),
      prisma.paymentAttempt.groupBy({
        by: ["status"],
        where: { owner_id: userId, hostel_id: hostelId, created_at: { gte: monthStart, lt: nextMonthStart } },
        _count: { id: true },
      }),
    ]);

    const hostel = (hostelRaw && hostelRaw.owner_id === userId) ? hostelRaw : null;

    const expectedRevenue = Number(currentExpected._sum.total_amount || 0);
    const previousRevenue = Number(previousPayments._sum.amount_paid || 0);
    const previousExpectedRevenue = Number(previousExpected._sum.total_amount || 0);
    const previousExpenses = Number(previousCosts._sum.amount || 0);
    const netProfit = currentRevenue - monthlyExpenses;
    const previousProfit = previousRevenue - previousExpenses;
    const profitMargin = currentRevenue > 0 ? Math.round((netProfit / currentRevenue) * 100) : 0;
    const collectionRate = expectedRevenue > 0 ? Math.round((currentRevenue / expectedRevenue) * 100) : 0;
    const previousCollectionRate = previousExpectedRevenue > 0 ? Math.round((previousRevenue / previousExpectedRevenue) * 100) : 0;
    const expenseRatio = currentRevenue > 0 ? Math.round((monthlyExpenses / currentRevenue) * 100) : 0;
    const expensePerTenant = activeTenants > 0 ? Math.round(monthlyExpenses / activeTenants) : 0;
    const revenuePerOccupiedBed = occupiedBeds > 0 ? Math.round(currentRevenue / occupiedBeds) : 0;
    const avgBedRevenue = occupiedBeds > 0 ? currentRevenue / occupiedBeds : 0;
    const vacancyLossEstimate = Math.round(availableBeds * avgBedRevenue);
    const occupancyTrend = occupancyRate - (Number(occupancyProfitRows.at(-30)?.occupancy_rate || occupancyRate) || occupancyRate);
    const revenueTrend = previousRevenue > 0 ? Math.round(((currentRevenue - previousRevenue) / previousRevenue) * 100) : currentRevenue > 0 ? 100 : 0;
    const profitTrend = previousProfit !== 0 ? Math.round(((netProfit - previousProfit) / Math.abs(previousProfit)) * 100) : netProfit > 0 ? 100 : 0;
    const expenseGrowth = previousExpenses > 0 ? Math.round(((monthlyExpenses - previousExpenses) / previousExpenses) * 100) : monthlyExpenses > 0 ? 100 : 0;

    const previousCategoryMap = new Map(previousCategoryExpenses.map((row) => [row.category, Number(row._sum.amount || 0)]));
    const expenseCategories = categoryExpenses
      .map((row) => {
        const amount = Number(row._sum.amount || 0);
        const previous = previousCategoryMap.get(row.category) || 0;
        const trend = previous > 0 ? Math.round(((amount - previous) / previous) * 100) : amount > 0 ? 100 : 0;
        return {
          category: row.category,
          amount,
          percentage: monthlyExpenses > 0 ? Math.round((amount / monthlyExpenses) * 100) : 0,
          trend,
        };
      })
      .sort((a, b) => b.amount - a.amount);
    const topExpenseCategory = expenseCategories[0] || null;
    const fixedCategories = new Set(["Internet", "Security", "Staff Salary", "Salary"]);
    const fixedExpenses = expenseCategories.filter((c) => fixedCategories.has(c.category)).reduce((sum, c) => sum + c.amount, 0);
    const fixedCostRatio = monthlyExpenses > 0 ? Math.round((fixedExpenses / monthlyExpenses) * 100) : 0;

    const roomUtilization = rooms.map((room: any) => {
      const snapshot = capacityMap.get(room.id);
      const occupied = snapshot?.occupied ?? room.room_allocations.length;
      const reserved = snapshot?.reserved ?? 0;
      const capacity = Number(room.capacity || 0);
      return {
        id: room.id,
        room_no: room.room_no,
        floor: room.floor_ref?.name || (room.floor != null ? `Floor ${room.floor}` : "Unassigned"),
        room_type: room.room_type || "Standard",
        capacity: snapshot?.capacity ?? capacity,
        occupied,
        reserved,
        used: snapshot?.used ?? occupied,
        vacant: snapshot?.available ?? Math.max(capacity - occupied, 0),
        state: snapshot?.state ?? (occupied >= capacity ? "full" : occupied === 0 ? "vacant" : "partial"),
      };
    });
    const fullRooms = roomUtilization.filter((r: any) => r.state === "full").length;
    const partialRooms = roomUtilization.filter((r: any) => r.state === "partial").length;
    const vacantRooms = roomUtilization.filter((r: any) => r.state === "vacant").length;
    const floorMap = new Map<string, { floor: string; capacity: number; occupied: number }>();
    for (const room of roomUtilization as any[]) {
      const current = floorMap.get(room.floor) || { floor: room.floor, capacity: 0, occupied: 0 };
      current.capacity += room.capacity;
      current.occupied += room.used;
      floorMap.set(room.floor, current);
    }
    const floorOccupancy = Array.from(floorMap.values()).map((f) => ({
      ...f,
      occupancy_rate: f.capacity > 0 ? Math.round((f.occupied / f.capacity) * 100) : 0,
    }));

    const duesAging = {
      total_dues: pendingTotal,
      overdue_dues: overdueTotal,
      due_today: Number(dueTodayAgg._sum.total_amount || 0),
      due_this_week: Number(dueWeekAgg._sum.total_amount || 0),
      oldest_unpaid_due: oldestUnpaid?.due_date || null,
      overdue_30_plus_count: obligationsRisk.filter((o) => (today.getTime() - new Date(o.due_date).getTime()) / 86400000 > 30).length,
    };
    const activeDisputeCount = Number(activeDisputeRows?.[0]?.active_dispute_count || 0);
    const activeDisputeAmount = Number(activeDisputeRows?.[0]?.active_dispute_amount || 0);
    const agreementAlerts = await this.getAgreementAlertCounts(userId, hostelId);

    const highRiskTenants = obligationsRisk.map((ob: any) => {
      const paid = ob.payments.reduce((sum: number, p: any) => sum + Number(p.amount_paid || 0), 0);
      const balance = Math.max(0, Number(ob.total_amount || ob.amount || 0) - paid);
      const daysOverdue = Math.max(0, Math.floor((today.getTime() - new Date(ob.due_date).getTime()) / 86400000));
      return {
        tenant_id: ob.tenant_id,
        tenant_name: ob.tenants?.profiles?.name || "Tenant",
        phone: ob.tenants?.profiles?.phone || null,
        balance,
        days_overdue: daysOverdue,
        risk: daysOverdue > 30 || balance > 20000 ? "critical" : daysOverdue > 7 ? "high" : "medium",
      };
    }).sort((a, b) => (b.days_overdue - a.days_overdue) || (b.balance - a.balance)).slice(0, 5);

    const reminderConversionRate = remindersSent > 0 ? Math.round((reminderConversions / remindersSent) * 100) : 0;
    const mostEffectiveChannel = reminderChannels.sort((a, b) => b._count.id - a._count.id)[0]?.channel || null;
    const tenantChurnRate = activeTenants > 0 ? Math.round((exitsThisMonth / activeTenants) * 100) : 0;

    const attemptCountByStatus = new Map(paymentAttemptStats.map((s) => [s.status, s._count.id]));
    const attemptsTotal = [...attemptCountByStatus.values()].reduce((a, b) => a + b, 0);
    const attemptsFailed = (attemptCountByStatus.get("FAILED") || 0);
    const attemptsPendingVerification = (attemptCountByStatus.get("PENDING_VERIFICATION") || 0) + (attemptCountByStatus.get("PENDING_MANUAL_CONFIRMATION") || 0);
    const attemptsExpired = (attemptCountByStatus.get("EXPIRED") || 0);
    const attemptsSuccess = (attemptCountByStatus.get("SUCCESS") || 0);
    const attemptsDecisive = attemptsTotal - (attemptCountByStatus.get("CREATED") || 0) - (attemptCountByStatus.get("PENDING") || 0) - (attemptCountByStatus.get("PROCESSING") || 0);
    const upiFailureRate = attemptsDecisive > 0 ? Math.round((attemptsFailed / attemptsDecisive) * 100) : 0;

    let operationalScore = 100;
    operationalScore -= Math.max(0, 90 - occupancyRate) * 0.5;
    operationalScore -= Math.max(0, 95 - collectionRate) * 0.35;
    operationalScore -= Math.max(0, expenseRatio - 35) * 0.45;
    operationalScore -= Math.max(0, 20 - profitMargin) * 0.6;
    operationalScore -= Math.min(20, overdueCount * 4);
    operationalScore -= Math.min(12, tenantChurnRate * 1.5);
    operationalScore = Math.max(0, Math.min(100, Math.round(operationalScore)));
    const operationalState = operationalScore >= 85 ? "Excellent" : operationalScore >= 70 ? "Healthy" : operationalScore >= 45 ? "At Risk" : "Critical";
    const profitabilityStatus = profitMargin >= 30 && pendingTotal < currentRevenue * 0.15 && occupancyRate >= 85 && expenseRatio <= 35
      ? "Highly Profitable"
      : profitMargin >= 18 && occupancyRate >= 70
        ? "Stable"
        : profitMargin >= 0 && operationalScore >= 45
          ? "Attention Needed"
          : "Critical";

    const alerts = [
      ...(agreementAlerts.expired > 0 ? [{
        severity: "critical",
        title: `${agreementAlerts.expired} expired agreement${agreementAlerts.expired === 1 ? "" : "s"}`,
        impact: "Occupied tenants may be staying without a valid current contract",
        action: "Review agreement renewals",
        cta: "Open tenants",
      }] : []),
      ...(agreementAlerts.expiringSoon > 0 ? [{
        severity: "warning",
        title: `${agreementAlerts.expiringSoon} agreement${agreementAlerts.expiringSoon === 1 ? "" : "s"} expiring soon`,
        impact: "Renew before contract expiry",
        action: "Follow up with tenants",
        cta: "Open tenants",
      }] : []),
      ...(activeDisputeCount > 0 ? [{
        severity: "critical",
        title: `${activeDisputeCount} settlement dispute${activeDisputeCount === 1 ? "" : "s"} open`,
        impact: `₹${activeDisputeAmount.toLocaleString("en-IN")} at risk`,
        action: "Review tenant dispute before closing move-out",
        cta: "Open move-outs",
      }] : []),
      ...(overdueTotal > 0 ? [{
        severity: overdueCount > 2 || duesAging.overdue_30_plus_count > 0 ? "critical" : "warning",
        title: `${overdueCount} tenant${overdueCount === 1 ? "" : "s"} overdue`,
        impact: `${overdueTotal.toLocaleString("en-IN")} pending collection risk`,
        action: "Collect or send reminder today",
        cta: "Review dues",
      }] : []),
      ...(occupancyRate < 70 ? [{
        severity: occupancyRate < 60 ? "critical" : "warning",
        title: "Low occupancy pressure",
        impact: `${availableBeds} vacant beds may cost ₹${vacancyLossEstimate.toLocaleString("en-IN")}`,
        action: "Push room filling or adjust pricing",
        cta: "Open rooms",
      }] : []),
      ...(unassignedActiveTenants > 0 ? [{
        severity: "warning",
        title: `${unassignedActiveTenants} active tenant${unassignedActiveTenants === 1 ? "" : "s"} need room allocation`,
        impact: "These tenants are active but not occupying a room",
        action: "Assign rooms before trusting occupancy reports",
        cta: "Open tenants",
      }] : []),
      ...(expenseRatio > 45 ? [{
        severity: expenseRatio > 60 ? "critical" : "warning",
        title: "Expenses consuming revenue",
        impact: `${expenseRatio}% of collections are going to operations`,
        action: "Check top expense categories",
        cta: "Open expenses",
      }] : []),
      ...(pendingInvites > 0 ? [{
        severity: "info",
        title: `${pendingInvites} onboarding pending`,
        impact: "Invited tenants have not completed activation",
        action: "Follow up before rooms stay vacant",
        cta: "Open tenants",
      }] : []),
      ...(moveOutOpen > 0 ? [{
        severity: "warning",
        title: `${moveOutOpen} move-out request${moveOutOpen === 1 ? "" : "s"} open`,
        impact: "Upcoming vacancy or settlement work",
        action: "Resolve inspection and replacement plan",
        cta: "Open move-outs",
      }] : []),
    ].slice(0, 6);

    const recentActivity = [
      ...recentPayments.map((p: any) => ({
        type: "payment",
        title: `${p.tenants?.profiles?.name || "Tenant"} paid ₹${Number(p.amount_paid || 0).toLocaleString("en-IN")}`,
        detail: p.payment_method,
        date: p.payment_date,
      })),
      ...recentExpenses.map((e: any) => ({
        type: "expense",
        title: `${e.category} expense added`,
        detail: `${e.title} · ₹${Number(e.amount || 0).toLocaleString("en-IN")}`,
        date: e.date,
      })),
      ...recentMoveOuts.map((m: any) => ({
        type: "moveout",
        title: `${m.tenant?.profiles?.name || "Tenant"} move-out ${String(m.status).toLowerCase()}`,
        detail: m.reason_text || String(m.reason || "Move-out request"),
        date: m.created_at,
      })),
      ...recentAllocations.map((a: any) => ({
        type: "allocation",
        title: `${a.tenant?.profiles?.name || "Tenant"} allocated room ${a.room?.room_no || ""}`.trim(),
        detail: "Room allocation",
        date: a.created_at,
      })),
    ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 12);

    return {
      hostel: {
        id: hostel?.id || hostelId,
        name: hostel?.name || "Hostel",
        location: hostel?.city || hostel?.address || "",
        phone: hostel?.phone || null,
        status: hostel?.status === "ACTIVE" ? "Active" : hostel?.status === "INACTIVE" ? "Inactive" : "Archived",
      },
      total_rooms: Number(roomStats[0]?.total_rooms ?? 0),
      occupied_rooms: Number(Array.isArray(occupiedRoomCount) ? occupiedRoomCount[0]?.count || 0 : occupiedRoomCount || 0),
      total_tenants: totalTenants,
      active_tenants: activeTenants,
      occupied_beds: occupiedBeds,
      reserved_beds: Math.max(0, usedBeds - occupiedBeds),
      unassigned_active_tenants: unassignedActiveTenants,
      total_capacity: totalCapacity,
      vacant_beds: availableBeds,
      occupancy_rate: occupancyRate,
      revenue: currentRevenue,
      total_revenue: currentRevenue,
      monthly_revenue: currentRevenue,
      expenses_this_month: monthlyExpenses,
      rent_collected_this_month: currentRevenue,
      pending_dues: pendingTotal,
      overdue_amount: overdueTotal,
      overdue_count: overdueCount,
      overdue_tenants: overdueCount,
      unpaid_tenant_count: unpaidTenantCount,
      expected_revenue: expectedRevenue,
      collection_rate: collectionRate,
      net_profit: netProfit,
      profit_margin: profitMargin,
      expense_revenue_ratio: expenseRatio,
      expense_per_tenant: expensePerTenant,
      revenue_per_occupied_bed: revenuePerOccupiedBed,
      vacancy_loss_estimate: vacancyLossEstimate,
      tenant_churn_rate: tenantChurnRate,
      reminder_conversion_rate: reminderConversionRate,
      operational_score: operationalScore,
      operational_state: operationalState,
      profitability_status: profitabilityStatus,
      intelligence: {
        health: {
          score: operationalScore,
          state: operationalState,
          profitability_status: profitabilityStatus,
          occupancy_state: occupancyRate >= 90 ? "Healthy" : occupancyRate >= 60 ? "Moderate" : "Dangerous",
          profit_state: netProfit < 0 ? "loss" : profitMargin >= 20 ? "healthy" : "unstable",
        },
        kpis: {
          occupancy: {
            value: occupancyRate,
            occupied_beds: occupiedBeds,
            reserved_beds: Math.max(0, usedBeds - occupiedBeds),
            vacant_beds: availableBeds,
            unassigned_active_tenants: unassignedActiveTenants,
            trend: Math.round(occupancyTrend),
            insight: `${availableBeds} vacant beds need filling`,
          },
          revenue: {
            collected: currentRevenue,
            expected: expectedRevenue,
            collection_rate: collectionRate,
            trend: revenueTrend,
            insight: `₹${pendingTotal.toLocaleString("en-IN")} pending from ${unpaidTenantCount} tenants`,
          },
          profit: {
            amount: netProfit,
            margin: profitMargin,
            trend: profitTrend,
            insight: profitTrend < 0 ? `Profit trend down ${Math.abs(profitTrend)}%` : `Profit trend up ${profitTrend}%`,
          },
          dues: {
            pending: pendingTotal,
            overdue_tenants: overdueCount,
            oldest_unpaid_due: oldestUnpaid?.due_date || null,
            insight: `${duesAging.overdue_30_plus_count} tenants overdue beyond 30 days`,
          },
          expenses: {
            amount: monthlyExpenses,
            ratio: expenseRatio,
            top_category: topExpenseCategory,
            insight: topExpenseCategory?.trend > 30 ? `${topExpenseCategory.category} increased ${topExpenseCategory.trend}%` : "Expenses are within tracked range",
          },
          tenant_stability: {
            move_out_requests: moveOutOpen,
            new_joins: joinsThisMonth,
            exits: exitsThisMonth,
            churn_rate: tenantChurnRate,
            insight: tenantChurnRate > 10 ? "High tenant churn detected" : "Tenant movement looks stable",
          },
        },
        revenue: {
          trend: monthlyRows,
          collection_efficiency: {
            collection_rate: collectionRate,
            trend: collectionRate - previousCollectionRate,
            average_payment_delay_days: highRiskTenants.length ? Math.round(highRiskTenants.reduce((s, t) => s + t.days_overdue, 0) / highRiskTenants.length) : 0,
            late_fee_collected: 0,
            pending_amount: pendingTotal,
          },
          revenue_per_occupied_bed: revenuePerOccupiedBed,
        },
        occupancy: {
          room_utilization: roomUtilization,
          summary: { full_rooms: fullRooms, partial_rooms: partialRooms, vacant_rooms: vacantRooms },
          floor_occupancy: floorOccupancy,
          vacancy_risk: {
            vacant_beds: availableBeds,
            vacancy_loss_estimate: vacancyLossEstimate,
            insight: occupancyRate < 70 ? "Occupancy is dragging profitability" : "Occupancy is supporting revenue",
          },
          occupancy_vs_profit: occupancyProfitRows.map((row) => ({
            date: row.snapshot_date,
            occupancy: Number(row.occupancy_rate || 0),
            profit: Number(row.profit || 0),
          })).slice(-30),
        },
        dues: {
          summary: duesAging,
          high_risk_tenants: highRiskTenants,
          reminder_conversion: {
            sent: remindersSent,
            conversions: reminderConversions,
            conversion_rate: reminderConversionRate,
            best_channel: mostEffectiveChannel,
          },
          low_behavior_scores: highRiskScores.map((row: any) => ({
            tenant_id: row.tenant_id,
            tenant_name: row.tenants?.profiles?.name || "Tenant",
            score: row.score,
            phone: row.tenants?.profiles?.phone || null,
          })),
        },
        expenses: {
          categories: expenseCategories.slice(0, 6),
          growth: expenseGrowth,
          fixed_variable_ratio: fixedCostRatio,
          expense_per_tenant: expensePerTenant,
          anomalies: expenseCategories.filter((c) => c.trend > 35).slice(0, 3),
        },
        tenant_movement: {
          recent_joins: joinsThisMonth,
          move_out_requests: moveOutOpen,
          exits_this_month: exitsThisMonth,
          pending_onboarding: pendingInvites,
          inactive_invitations: inactiveInvites,
        },
        payment_attempts: {
          total: attemptsTotal,
          success: attemptsSuccess,
          failed: attemptsFailed,
          pending_verification: attemptsPendingVerification,
          abandoned: attemptsExpired,
          upi_failure_rate: upiFailureRate,
        },
        alerts,
        recent_activity: recentActivity,
      },
    };
  }

  async getMonthlyStats(userId: string, hostelId: string, months: number = 6) {
    const now = new Date();

    // Build all date ranges first so we can fire every query in one parallel batch
    // instead of awaiting each iteration serially (was: months × 2 = 12 sequential round trips).
    const ranges = Array.from({ length: months }, (_, i) => {
      const targetMonth     = now.getUTCMonth() - i;
      const targetYear      = now.getUTCFullYear() + Math.floor(targetMonth / 12);
      const normalizedMonth = ((targetMonth % 12) + 12) % 12;
      const start = new Date(Date.UTC(targetYear, normalizedMonth, 1, 0, 0, 0, 0));
      const end   = new Date(Date.UTC(targetYear, normalizedMonth + 1, 0, 0, 0, 0, 0));
      return { start, end };
    });

    const results = await Promise.all(
      ranges.map(({ start, end }) => financialService.getOperationalCashflowMetrics(userId, start, end, hostelId))
    );

    return results
      .map((cf, i) => {
        const { start }        = ranges[i];
        const collectedAmount  = Number(cf.collected_total || 0);
        const dueAmount        = Number(cf.expected_total || 0);
        return {
          month: formatShortMonth(start),
          year:  start.getFullYear(),
          collected: collectedAmount,
          due:       dueAmount,
          collection_rate: Number(cf.collection_rate || 0),
        };
      })
      .reverse();
  }

  async getTenantStats(profileId: string) {
    const tenant = await prisma.tenants.findUnique({
      where: { profile_id: profileId },
      include: {
        room_allocations: { where: { is_active: true, end_date: null }, include: { room: true } },
        rent_obligations: { 
          where: { status: { in: ["PENDING", "PARTIAL"] } }, 
          orderBy: { due_date: "asc" },
          include: { payments: { select: { amount_paid: true } } }
        }
      }
    });

    if (!tenant) throw new Error("NOT_FOUND: Tenant record not found");

    if (!tenant.hostel_id) throw new Error("HOSTEL_CONTEXT_REQUIRED: tenant hostel scope unavailable");
    const dues = await financialService.getTenantDues(tenant.id, tenant.owner_id || undefined, tenant.hostel_id);
    const pendingTotal = dues.total_due;
    const nextItem = dues.items[0];
    const nextPayment: Date | null = nextItem?.due_date ?? null;
    const oldestObligationId: string | null = nextItem?.obligation_id ?? null;

    return {
      tenant_id: tenant.id,
      room_no: (tenant as any).room_allocations[0]?.room.room_no || "Not Assigned",
      monthly_rent: Number(tenant.monthly_rent),
      pending_dues: pendingTotal,
      next_payment_date: nextPayment,
      oldest_obligation_id: oldestObligationId,
      status: tenant.status
    };
  }
}

export const dashboardService = new DashboardService();
