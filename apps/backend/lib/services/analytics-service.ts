import { prisma } from "../db";
import { Prisma } from "@prisma/client";
import { financialService } from "../../src/services/payments/financial-service";
import { operationalPendingInvariantHolds } from "./financial-invariants";

// ─── Decision Engine ──────────────────────────────────────────────────────────

type Severity = "LOW" | "MEDIUM" | "HIGH";

type Action =
  | { type: "SEND_REMINDERS"; tenant_ids: string[]; label: string; urgency: "HIGH" | "MEDIUM" }
  | { type: "VIEW_DEFAULTERS"; label: string }
  | { type: "FILL_VACANCY";    label: string }
  | { type: "REVIEW_EXPENSES"; label: string }
  | { type: "ANALYZE_TENANTS"; label: string };

/**
 * value ≤ thresholds.low → LOW
 * value ≥ thresholds.high → HIGH
 * otherwise → MEDIUM
 * Pass the "bad" direction of a metric (e.g. 100 - collection_rate).
 */
function getSeverity(value: number, thresholds: { low: number; high: number }): Severity {
  if (value <= thresholds.low)  return "LOW";
  if (value >= thresholds.high) return "HIGH";
  return "MEDIUM";
}

function fmtAmount(n: number): string {
  if (n >= 10_00_000) return `₹${(n / 1_00_000).toFixed(1)}L`;
  if (n >= 1_000)     return `₹${(n / 1_000).toFixed(1)}K`;
  return `₹${Math.round(n)}`;
}

// ─────────────────────────────────────────────────────────────────────────────

export function getDateRange(from?: string | null, to?: string | null) {
  const now = new Date();
  const start = from ? new Date(from) : new Date(now.getFullYear(), now.getMonth(), 1);
  const end   = to   ? new Date(to)   : new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  return { start, end };
}

export class AnalyticsService {

  // ── Dashboard 1: Cashflow ──────────────────────────────────────────────────

  async getCashflowDashboard(ownerId: string, start: Date, end: Date, hostelId: string) {

    // ── Single-pass CTE: replaces 3 separate overdue scans + a tenant findMany ─
    // Before: overdueAgg (aggregate), overdueGroups (groupBy), dueDates (raw) + tenants (findMany)
    // After:  one query returning sum + count + top-5 with names + earliest_due
    const hostelFilter = Prisma.sql`AND p.hostel_id = ${hostelId}::uuid`;
    const [cashflow, daily, topDefaulters] = await Promise.all([
      financialService.getOperationalCashflowMetrics(ownerId, start, end, hostelId),
      prisma.$queryRaw<{ date: string; amount: number }[]>`
        SELECT payment_date::text AS date, SUM(amount_paid)::float AS amount
        FROM payments p
        WHERE p.owner_id = ${ownerId}::uuid
          AND p.payment_date >= ${start}::date
          AND p.payment_date <= ${end}::date
          ${hostelFilter}
        GROUP BY payment_date ORDER BY payment_date
      `,
      financialService.getOperationalDefaulters(ownerId, 5, hostelId),
    ]);

    const expected = Number(cashflow.expected_total || 0);
    const collected = Number(cashflow.collected_total || 0);
    const pending = Number(cashflow.pending_total || 0);
    const overdue = Number(cashflow.overdue_total || 0);
    const canonicalUnpaidTenantCount = operationalPendingInvariantHolds(
      pending,
      Number(cashflow.unpaid_tenant_count || 0),
    ) ? Number(cashflow.unpaid_tenant_count || 0) : 0;
    const overdueTenantsCount = Math.min(
      Number(cashflow.overdue_tenant_count || 0),
      canonicalUnpaidTenantCount,
    );
    const top_defaulters = topDefaulters.map((d) => ({
      tenant_id: d.tenant_id,
      name: d.name,
      pending_amount: d.pending_amount,
      days_overdue: d.days_overdue,
    }));

    const collection_rate = Number(cashflow.collection_rate || 0);

    // ── Decision layer ────────────────────────────────────────────────────────
    const uncollectedPct  = expected > 0 ? Math.round((1 - collected / expected) * 100) : 0;
    const severity        = getSeverity(uncollectedPct, { low: 20, high: 50 });

    const predicted_collection = Math.round(collected + pending * (collection_rate / 100));
    const expected_loss        = Math.max(0, Math.round(expected - predicted_collection));

    const insights: string[] = [];
    insights.push(`Collection rate is ${collection_rate}% — ${fmtAmount(collected)} collected of ${fmtAmount(expected)} expected`);
    if (overdue > 0)
      insights.push(`${fmtAmount(overdue)} overdue across ${overdueTenantsCount} tenant${overdueTenantsCount !== 1 ? "s" : ""}`);
    if (pending > 0)
      insights.push(`${fmtAmount(pending)} still pending this period`);
    if (expected_loss > 0)
      insights.push(`Predicted loss: ${fmtAmount(expected_loss)} if current collection rate holds`);

    const actions: Action[] = [];
    if (top_defaulters.length > 0)
      actions.push({
        type: "SEND_REMINDERS",
        tenant_ids: top_defaulters.map((d) => d.tenant_id),
        label: `Send reminders to ${top_defaulters.length} top defaulter${top_defaulters.length !== 1 ? "s" : ""}`,
        urgency: severity === "HIGH" ? "HIGH" : "MEDIUM",
      });
    if (overdueTenantsCount > 0)
      actions.push({ type: "VIEW_DEFAULTERS", label: `Review ${overdueTenantsCount} overdue tenant${overdueTenantsCount !== 1 ? "s" : ""}` });

    return {
      data: {
        expected_rent:          expected,
        collected_amount:       collected,
        pending_amount:         pending,
        collection_rate,
        overdue_amount:         overdue,
        overdue_tenants_count:  overdueTenantsCount,
        unpaid_tenants_count:   canonicalUnpaidTenantCount,
        predicted_collection,
        expected_loss,
        top_defaulters,
        daily_collection: daily.map((r) => ({ date: r.date, amount: r.amount })),
      },
      insights,
      actions,
      severity,
    };
  }

  // ── Dashboard 2: Tenant Intelligence ──────────────────────────────────────

  async getTenantIntelligenceDashboard(ownerId: string, start: Date, end: Date, hostelId: string) {
    const tenantHostelFilter = Prisma.sql`AND t.hostel_id = ${hostelId}::uuid`;
    const paymentHostelFilter = Prisma.sql`AND pay.hostel_id = ${hostelId}::uuid`;
    const [distRows, riskyRows, behaviorRows, depRows, exitRows, totalExited, activeCount] =
      await Promise.all([
        prisma.$queryRaw<{ good: bigint; medium: bigint; risky: bigint }[]>`
          SELECT
            COUNT(CASE WHEN tbs.score >= 80 THEN 1 END) AS good,
            COUNT(CASE WHEN tbs.score >= 50 AND tbs.score < 80 THEN 1 END) AS medium,
            COUNT(CASE WHEN tbs.score < 50 THEN 1 END) AS risky
          FROM tenant_behavior_scores tbs
          JOIN tenants t ON t.id = tbs.tenant_id
          WHERE t.owner_id = ${ownerId}::uuid AND t.status = 'ACTIVE'
            ${tenantHostelFilter}
        `,
        prisma.$queryRaw<{ tenant_id: string; name: string; score: number; avg_delay_days: number }[]>`
          SELECT t.id AS tenant_id, p.name, COALESCE(tbs.score, 100) AS score,
            COALESCE(AVG(CASE WHEN pay.payment_date > o.due_date THEN pay.payment_date - o.due_date END), 0)::float AS avg_delay_days
          FROM tenants t
          JOIN profiles p ON p.id = t.profile_id
          LEFT JOIN tenant_behavior_scores tbs ON tbs.tenant_id = t.id
          LEFT JOIN rent_obligations o ON o.tenant_id = t.id
          LEFT JOIN payments pay ON pay.tenant_id = t.id AND pay.obligation_id = o.id
          WHERE t.owner_id = ${ownerId}::uuid AND t.status = 'ACTIVE'
            AND COALESCE(tbs.score, 100) < 50
            ${tenantHostelFilter}
          GROUP BY t.id, p.name, tbs.score
          ORDER BY COALESCE(tbs.score, 100) ASC LIMIT 10
        `,
        prisma.$queryRaw<{ on_time: bigint; total: bigint; avg_delay: number }[]>`
          SELECT
            COUNT(CASE WHEN pay.payment_date <= o.due_date THEN 1 END) AS on_time,
            COUNT(*) AS total,
            COALESCE(AVG(CASE WHEN pay.payment_date > o.due_date THEN pay.payment_date - o.due_date END), 0)::float AS avg_delay
          FROM payments pay
          JOIN rent_obligations o ON o.id = pay.obligation_id
          JOIN tenants t ON t.id = pay.tenant_id
          WHERE t.owner_id = ${ownerId}::uuid
            AND pay.payment_date >= ${start}::date AND pay.payment_date <= ${end}::date
            ${paymentHostelFilter}
        `,
        prisma.$queryRaw<{ total_paid: bigint; with_reminder: bigint }[]>`
          WITH paid AS (
            SELECT DISTINCT pay.obligation_id
            FROM payments pay JOIN tenants t ON t.id = pay.tenant_id
            WHERE t.owner_id = ${ownerId}::uuid
              AND pay.payment_date >= ${start}::date AND pay.payment_date <= ${end}::date
              ${paymentHostelFilter}
          )
          SELECT COUNT(*) AS total_paid,
            COUNT(CASE WHEN rl.obligation_id IS NOT NULL THEN 1 END) AS with_reminder
          FROM paid
          LEFT JOIN LATERAL (
            SELECT obligation_id FROM reminder_logs WHERE obligation_id = paid.obligation_id LIMIT 1
          ) rl ON true
        `,
        prisma.$queryRaw<{ reason: string; count: bigint }[]>`
          SELECT COALESCE(exit_reason,'Not specified') AS reason, COUNT(*) AS count
          FROM tenants
          WHERE owner_id = ${ownerId}::uuid AND status = 'FORMER_TENANT'
            AND exit_date >= ${start}::date AND exit_date <= ${end}::date
            AND hostel_id = ${hostelId}::uuid
          GROUP BY exit_reason ORDER BY count DESC LIMIT 5
        `,
        prisma.tenants.count({
          where: { owner_id: ownerId, hostel_id: hostelId, status: "FORMER_TENANT", exit_date: { gte: start, lte: end } },
        }),
        // ─ was sequential after the block; now fully parallel ─
        prisma.tenants.count({ where: { owner_id: ownerId, hostel_id: hostelId, status: "ACTIVE" } }),
      ]);

    const dist = distRows[0];
    const beh  = behaviorRows[0];
    const dep  = depRows[0];
    const tot  = Number(beh?.total ?? 0); const onT = Number(beh?.on_time ?? 0);
    const totP = Number(dep?.total_paid ?? 0); const rem = Number(dep?.with_reminder ?? 0);
    const base = activeCount + totalExited;

    const distribution    = { good: Number(dist?.good ?? 0), medium: Number(dist?.medium ?? 0), risky: Number(dist?.risky ?? 0) };
    const riskyOutstanding = await financialService.getOperationalOutstandingByTenants(
      ownerId,
      hostelId,
      riskyRows.map((r) => r.tenant_id),
    );

    const risky_tenants   = riskyRows.map((r) => ({
      tenant_id: r.tenant_id, name: r.name, score: r.score,
      pending_amount: Number(riskyOutstanding.get(r.tenant_id) || 0),
      avg_delay_days: Math.round(r.avg_delay_days * 10) / 10,
    }));
    const on_time_percentage       = tot > 0 ? Math.round((onT / tot) * 10000) / 100 : 0;
    const avg_delay_days           = Math.round(Number(beh?.avg_delay ?? 0) * 10) / 10;
    const reminder_dependency_rate = totP > 0 ? Math.round((rem / totP) * 10000) / 100 : 0;
    const churn_rate               = base > 0 ? Math.round((totalExited / base) * 10000) / 100 : 0;

    // ── Decision layer ────────────────────────────────────────────────────────
    const scoredTotal = distribution.good + distribution.medium + distribution.risky;
    const risky_pct   = scoredTotal > 0 ? Math.round((distribution.risky / scoredTotal) * 100) : 0;
    const severity    = getSeverity(risky_pct, { low: 10, high: 25 });

    const insights: string[] = [];
    insights.push(`${risky_pct}% of scored tenants are high risk (behavior score < 50)`);
    insights.push(`${on_time_percentage}% of payments made on time — avg delay ${avg_delay_days} day${avg_delay_days !== 1 ? "s" : ""}`);
    if (reminder_dependency_rate > 0)
      insights.push(`${reminder_dependency_rate}% of payments required a reminder before being made`);
    if (totalExited > 0)
      insights.push(`${totalExited} tenant${totalExited !== 1 ? "s" : ""} exited this period — ${churn_rate}% churn rate`);
    if (exitRows.length > 0 && exitRows[0].reason !== "Not specified")
      insights.push(`Top exit reason: "${exitRows[0].reason}" (${Number(exitRows[0].count)} case${Number(exitRows[0].count) !== 1 ? "s" : ""})`);

    const actions: Action[] = [];
    actions.push({ type: "ANALYZE_TENANTS", label: `Review ${distribution.risky} high-risk tenant${distribution.risky !== 1 ? "s" : ""}` });
    if (risky_tenants.length > 0)
      actions.push({
        type: "SEND_REMINDERS",
        tenant_ids: risky_tenants.map((r) => r.tenant_id),
        label: `Send reminders to ${risky_tenants.length} risky tenant${risky_tenants.length !== 1 ? "s" : ""}`,
        urgency: severity === "HIGH" ? "HIGH" : "MEDIUM",
      });

    return {
      data: {
        distribution,
        risky_tenants,
        payment_behavior: { on_time_percentage, avg_delay_days, reminder_dependency_rate },
        exit_insights: {
          total_exits: totalExited,
          top_reasons: exitRows.map((r) => ({ reason: r.reason, count: Number(r.count) })),
          churn_rate,
        },
      },
      insights,
      actions,
      severity,
    };
  }

  // ── Dashboard 3: Reminder Funnel ──────────────────────────────────────────

  async getReminderFunnelDashboard(ownerId: string, start: Date, end: Date, hostelId: string) {
    const reminderHostelFilter = Prisma.sql`AND rl.hostel_id = ${hostelId}::uuid`;
    const reminderSubqueryHostelFilter = Prisma.sql`AND rl2.hostel_id = ${hostelId}::uuid`;
    const paymentHostelFilter = Prisma.sql`AND pay.hostel_id = ${hostelId}::uuid`;
    const [funnelRows, channelRows] = await Promise.all([
      prisma.$queryRaw<{ sent: bigint; converted: bigint; revenue: number; avg_hours: number }[]>`
        SELECT
          COUNT(*) AS sent,
          COUNT(CASE WHEN rl.converted_to_payment = true THEN 1 END) AS converted,
          COALESCE((
            SELECT SUM(pay.amount_paid)::float FROM payments pay
            JOIN tenants t2 ON t2.id = pay.tenant_id
            WHERE t2.owner_id = ${ownerId}::uuid
              AND pay.payment_date >= ${start}::date AND pay.payment_date <= ${end}::date
              ${paymentHostelFilter}
              AND pay.obligation_id IN (
                SELECT DISTINCT rl2.obligation_id FROM reminder_logs rl2
                JOIN tenants t3 ON t3.id = rl2.tenant_id
                WHERE t3.owner_id = ${ownerId}::uuid
                  AND rl2.sent_at >= ${start} AND rl2.sent_at <= ${end}
                  ${reminderSubqueryHostelFilter}
              )
          ), 0) AS revenue,
          COALESCE(AVG(
            CASE WHEN rl.converted_to_payment = true AND rl.converted_at IS NOT NULL
            THEN EXTRACT(EPOCH FROM (rl.converted_at - rl.sent_at)) / 3600.0 END
          ), 0)::float AS avg_hours
        FROM reminder_logs rl
        JOIN tenants t ON t.id = rl.tenant_id
        WHERE t.owner_id = ${ownerId}::uuid
          AND rl.sent_at >= ${start} AND rl.sent_at <= ${end}
          ${reminderHostelFilter}
      `,
      prisma.$queryRaw<{ channel: string; sent: bigint; converted: bigint }[]>`
        SELECT rl.channel,
          COUNT(*) AS sent,
          COUNT(CASE WHEN rl.converted_to_payment = true THEN 1 END) AS converted
        FROM reminder_logs rl
        JOIN tenants t ON t.id = rl.tenant_id
        WHERE t.owner_id = ${ownerId}::uuid
          AND rl.sent_at >= ${start} AND rl.sent_at <= ${end}
          ${reminderHostelFilter}
        GROUP BY rl.channel ORDER BY sent DESC
      `,
    ]);

    const f = funnelRows[0];
    const s = Number(f?.sent ?? 0); const c = Number(f?.converted ?? 0);

    const reminders_sent        = s;
    const conversions           = c;
    const conversion_rate       = s > 0 ? Math.round((c / s) * 10000) / 100 : 0;
    const revenue_generated     = Number(f?.revenue ?? 0);
    const avg_time_to_pay_hours = Math.round(Number(f?.avg_hours ?? 0) * 100) / 100;
    const channel_performance   = channelRows.map((r) => {
      const rs = Number(r.sent); const rc = Number(r.converted);
      return { channel: r.channel, sent: rs, converted: rc,
        conversion_rate: rs > 0 ? Math.round((rc / rs) * 10000) / 100 : 0 };
    });

    // ── Decision layer ────────────────────────────────────────────────────────
    // Spec: LOW > 40%, HIGH < 20% → pass (100 - conversion_rate) to getSeverity
    const severity = s === 0 ? "LOW" as Severity : getSeverity(100 - conversion_rate, { low: 60, high: 80 });

    const bestChannel = [...channel_performance].sort((a, b) => b.conversion_rate - a.conversion_rate)[0];

    const insights: string[] = [];
    if (s === 0) {
      insights.push("No reminders sent this period");
    } else {
      insights.push(`Reminders convert at ${conversion_rate}% — ${conversions} of ${reminders_sent} led to payment`);
      insights.push(`${fmtAmount(revenue_generated)} revenue influenced by reminders this period`);
      if (avg_time_to_pay_hours > 0)
        insights.push(`Tenants pay within ${avg_time_to_pay_hours}h on average after receiving a reminder`);
      if (bestChannel)
        insights.push(`Best channel: ${bestChannel.channel} at ${bestChannel.conversion_rate}% conversion rate`);
    }

    const actions: Action[] = [];
    if (s > 0 && conversion_rate >= 30)
      actions.push({
        type: "SEND_REMINDERS",
        tenant_ids: [],
        label: `Reminders are effective — send to all tenants with pending obligations`,
        urgency: conversion_rate >= 50 ? "HIGH" : "MEDIUM",
      });

    return {
      data: { reminders_sent, conversions, conversion_rate, revenue_generated, avg_time_to_pay_hours, channel_performance },
      insights,
      actions,
      severity,
    };
  }

  // ── Dashboard 4: Operations ───────────────────────────────────────────────

  async getOperationsDashboard(ownerId: string, start: Date, end: Date, hostelId: string) {
    const [roomRows, moveRows, revenueAgg, expenseAgg, complaintRows] = await Promise.all([
      prisma.$queryRaw<{ total_rooms: bigint; total_capacity: bigint; occupied_beds: bigint; avg_vacancy_days: number }[]>`
        SELECT
          COUNT(DISTINCT r.id) AS total_rooms,
          COALESCE(SUM(r.capacity), 0) AS total_capacity,
          COUNT(DISTINCT CASE WHEN ra.is_active = true THEN ra.id END) AS occupied_beds,
          COALESCE(AVG(
            CASE WHEN ra.is_active = false
              AND ra.end_date >= ${start}::date AND ra.end_date <= ${end}::date
              AND NOT EXISTS (SELECT 1 FROM room_allocations ra2 WHERE ra2.room_id = r.id AND ra2.is_active = true)
            THEN CURRENT_DATE - ra.end_date END
          ), 0)::float AS avg_vacancy_days
        FROM rooms r
        JOIN hostels h ON h.id = r.hostel_id
        LEFT JOIN room_allocations ra ON ra.room_id = r.id
        WHERE h.owner_id = ${ownerId}::uuid AND h.id = ${hostelId}::uuid AND r.is_active = true
      `,
      prisma.$queryRaw<{ move_ins: bigint; move_outs: bigint }[]>`
        SELECT
          COUNT(CASE WHEN ra.start_date >= ${start}::date AND ra.start_date <= ${end}::date THEN 1 END) AS move_ins,
          COUNT(CASE WHEN ra.end_date   >= ${start}::date AND ra.end_date   <= ${end}::date THEN 1 END) AS move_outs
        FROM room_allocations ra
        JOIN tenants t ON t.id = ra.tenant_id
        WHERE t.owner_id = ${ownerId}::uuid AND ra.hostel_id = ${hostelId}::uuid
      `,
      prisma.payments.aggregate({
        where: { owner_id: ownerId, hostel_id: hostelId, payment_date: { gte: start, lte: end } },
        _sum: { amount_paid: true },
      }),
      prisma.expenses.aggregate({
        where: { owner_id: ownerId, OR: [{ hostel_id: hostelId }, { hostel_id: null }], date: { gte: start, lte: end } },
        _sum: { amount: true },
      }),
      prisma.$queryRaw<{ pending: bigint; resolved: bigint; avg_hours: number }[]>`
        SELECT
          COUNT(CASE WHEN status = 'PENDING'  THEN 1 END) AS pending,
          COUNT(CASE WHEN status = 'RESOLVED' THEN 1 END) AS resolved,
          COALESCE(AVG(
            CASE WHEN resolved_at IS NOT NULL
            THEN EXTRACT(EPOCH FROM (resolved_at - created_at)) / 3600.0 END
          ), 0)::float AS avg_hours
        FROM complaints
        WHERE owner_id = ${ownerId}::uuid
          AND hostel_id = ${hostelId}::uuid
          AND created_at >= ${start} AND created_at <= ${end}
      `,
    ]);

    const r   = roomRows[0];
    const m   = moveRows[0];
    const cp  = complaintRows[0];
    const cap = Number(r?.total_capacity ?? 0);
    const occ = Number(r?.occupied_beds  ?? 0);
    const rev = Number(revenueAgg._sum.amount_paid ?? 0);
    const exp = Number(expenseAgg._sum.amount      ?? 0);

    const occupancy_rate   = cap > 0 ? Math.round((occ / cap) * 10000) / 100 : 0;
    const total_rooms      = Number(r?.total_rooms ?? 0);
    const avg_vacancy_days = Math.round(Number(r?.avg_vacancy_days ?? 0) * 10) / 10;
    const move_ins         = Number(m?.move_ins  ?? 0);
    const move_outs        = Number(m?.move_outs ?? 0);
    const profit           = rev - exp;
    const complaints       = {
      pending:                   Number(cp?.pending  ?? 0),
      resolved:                  Number(cp?.resolved ?? 0),
      avg_resolution_time_hours: Math.round(Number(cp?.avg_hours ?? 0) * 100) / 100,
    };

    // ── Decision layer ────────────────────────────────────────────────────────
    // severity: vacancy rate (100 - occupancy_rate); HIGH if > 40% vacant
    const severity      = getSeverity(100 - occupancy_rate, { low: 20, high: 40 });
    const vacant_beds   = Math.max(0, cap - occ);
    const profit_margin = rev > 0 ? Math.round((profit / rev) * 100) : 0;
    const expense_ratio = rev > 0 ? Math.round((exp / rev) * 100) : 0;
    const net_movement  = move_ins - move_outs;

    const insights: string[] = [];
    insights.push(`Occupancy is ${occupancy_rate}% — ${vacant_beds} bed${vacant_beds !== 1 ? "s" : ""} vacant out of ${cap} total`);
    if (rev > 0)
      insights.push(`Profit margin is ${profit_margin}% — ${fmtAmount(profit)} profit on ${fmtAmount(rev)} revenue`);
    if (avg_vacancy_days > 0)
      insights.push(`Vacant beds have been empty for ${avg_vacancy_days} days on average this period`);
    if (net_movement < 0)
      insights.push(`Net occupancy loss: ${Math.abs(net_movement)} more move-out${Math.abs(net_movement) !== 1 ? "s" : ""} than move-ins`);
    else if (net_movement > 0)
      insights.push(`Net occupancy gain: ${net_movement} more move-in${net_movement !== 1 ? "s" : ""} than move-outs`);
    if (complaints.pending > 0)
      insights.push(`${complaints.pending} complaint${complaints.pending !== 1 ? "s" : ""} pending — avg resolution time ${complaints.avg_resolution_time_hours}h`);
    if (exp > 0 && rev > 0)
      insights.push(`Expenses are ${expense_ratio}% of revenue — ${fmtAmount(exp)} spent this period`);

    const actions: Action[] = [];
    if (vacant_beds > 0)
      actions.push({ type: "FILL_VACANCY", label: `${vacant_beds} bed${vacant_beds !== 1 ? "s" : ""} available to fill` });
    if (exp > 0)
      actions.push({
        type: "REVIEW_EXPENSES",
        label: expense_ratio > 50
          ? `Expenses at ${expense_ratio}% of revenue — review for cost reduction`
          : `Monthly expenses: ${fmtAmount(exp)}`,
      });

    return {
      data: {
        occupancy_rate, total_rooms, occupied_rooms: occ, avg_vacancy_days,
        move_ins, move_outs, revenue: rev, expenses: exp, profit, complaints,
      },
      insights,
      actions,
      severity,
    };
  }
}

export const analyticsService = new AnalyticsService();
