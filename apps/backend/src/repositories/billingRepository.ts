import { prisma } from "../../lib/db";
import { Prisma } from "@prisma/client";
import { PAYABLE_STATUSES } from "../services/payments/settlement-planner";

export class BillingRepository {
  async getOperationalCashflowMetrics(ownerId: string, start: Date, end: Date, hostelId: string) {
    const now = new Date();
    const todayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const hostelFilter = Prisma.sql`AND o.hostel_id = ${hostelId}::uuid`;

    return await prisma.$queryRaw<any[]>`
      WITH base AS (
        SELECT
          o.id,
          o.tenant_id,
          o.total_amount::float                        AS amount,
          o.due_date,
          GREATEST(
            o.total_amount - COALESCE(pay_agg.total_paid, 0),
            0
          )::float                                     AS remaining
        FROM rent_obligations o
        JOIN tenants t ON t.id = o.tenant_id
        LEFT JOIN (
          SELECT obligation_id, SUM(amount_paid)::float AS total_paid
          FROM payments
          GROUP BY obligation_id
        ) pay_agg ON pay_agg.obligation_id = o.id
        WHERE o.owner_id = ${ownerId}::uuid
          AND o.status <> 'WAIVED'
          AND o.rent_month >= ${start}::date
          AND o.rent_month <= ${end}::date
          ${hostelFilter}
      )
      SELECT
        COALESCE(SUM(b.amount), 0)::float                                       AS expected_total,
        COALESCE(SUM(b.amount - b.remaining), 0)::float                         AS collected_total,
        COALESCE(SUM(b.remaining), 0)::float                                    AS pending_total,
        COALESCE(SUM(
          CASE WHEN b.due_date < ${todayUTC}::date
            THEN b.remaining
            ELSE 0
          END
        ), 0)::float                                                            AS overdue_total,
        COUNT(DISTINCT CASE WHEN b.remaining > 0 THEN b.tenant_id END)::int     AS unpaid_tenant_count,
        COUNT(DISTINCT CASE
          WHEN b.remaining > 0 AND b.due_date < ${todayUTC}::date
          THEN b.tenant_id
        END)::int                                                               AS overdue_tenant_count
      FROM base b
    `;
  }

  async getOperationalOutstandingByTenants(ownerId: string, hostelId: string, tenantIds: string[]) {
    return await prisma.$queryRaw<Array<{ tenant_id: string; outstanding: number }>>`
      SELECT
        o.tenant_id,
        COALESCE(SUM(
          GREATEST(o.total_amount - COALESCE(pay_agg.total_paid, 0), 0)
        ), 0)::float AS outstanding
      FROM rent_obligations o
      JOIN tenants t ON t.id = o.tenant_id
      LEFT JOIN (
        SELECT obligation_id, SUM(amount_paid)::float AS total_paid
        FROM payments
        GROUP BY obligation_id
      ) pay_agg ON pay_agg.obligation_id = o.id
      WHERE o.owner_id = ${ownerId}::uuid
        AND o.tenant_id = ANY(${tenantIds}::uuid[])
        AND o.hostel_id = ${hostelId}::uuid
        AND o.status IN ('PENDING', 'PARTIAL')
      GROUP BY o.tenant_id
    `;
  }

  async getOperationalDues(ownerId: string, hostelId: string) {
    const now = new Date();
    const todayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const hostelFilter = Prisma.sql`AND o.hostel_id = ${hostelId}::uuid`;

    return await prisma.$queryRaw<any[]>`
      SELECT
        COALESCE(SUM(
          o.total_amount - COALESCE(pay_agg.total_paid, 0)
        ), 0)::float                                                                  AS pending_total,
        COALESCE(SUM(
          CASE WHEN o.due_date < ${todayUTC}::date
            THEN o.total_amount - COALESCE(pay_agg.total_paid, 0)
            ELSE 0
          END
        ), 0)::float                                                                  AS overdue_total,
        COUNT(
          CASE WHEN o.due_date < ${todayUTC}::date
            AND o.total_amount - COALESCE(pay_agg.total_paid, 0) > 0
          THEN 1 END
        )::int                                                                        AS overdue_count,
        COUNT(DISTINCT t.id)::int                                                     AS unpaid_tenant_count,
        COUNT(DISTINCT CASE
          WHEN o.due_date < ${todayUTC}::date THEN t.id
        END)::int                                                                     AS overdue_tenant_count
      FROM rent_obligations o
      JOIN tenants t ON t.id = o.tenant_id
      LEFT JOIN (
        SELECT obligation_id, SUM(amount_paid)::float AS total_paid
        FROM payments
        GROUP BY obligation_id
      ) pay_agg ON pay_agg.obligation_id = o.id
      WHERE o.owner_id    = ${ownerId}::uuid
        AND o.status      IN ('PENDING', 'PARTIAL')
        AND o.total_amount - COALESCE(pay_agg.total_paid, 0) > 0
        ${hostelFilter}
    `;
  }

  async getOperationalDefaulters(ownerId: string, limit: number, hostelId: string) {
    const hostelFilter = Prisma.sql`AND o.hostel_id = ${hostelId}::uuid`;
    return await prisma.$queryRaw<Array<{
      tenant_id: string;
      name: string;
      pending_amount: number;
      days_overdue: number;
    }>>`
      WITH overdue AS (
        SELECT
          o.tenant_id,
          CASE WHEN t.profile_id IS NULL THEN COALESCE(t.display_name, 'Tenant') ELSE p.name END AS name,
          SUM(o.total_amount - COALESCE(pay_agg.total_paid, 0))::float AS pending_amount,
          MIN(o.due_date)                                         AS earliest_due
        FROM rent_obligations o
        JOIN tenants t ON t.id = o.tenant_id
        LEFT JOIN profiles p ON p.id = t.profile_id
        LEFT JOIN (
          SELECT obligation_id, SUM(amount_paid)::float AS total_paid
          FROM payments
          GROUP BY obligation_id
        ) pay_agg ON pay_agg.obligation_id = o.id
        WHERE o.owner_id = ${ownerId}::uuid
          AND o.status IN ('PENDING', 'PARTIAL')
          AND o.due_date < CURRENT_DATE
          AND o.total_amount - COALESCE(pay_agg.total_paid, 0) > 0
          ${hostelFilter}
        GROUP BY o.tenant_id, t.profile_id, t.display_name, p.name
      )
      SELECT
        tenant_id,
        name,
        pending_amount,
        GREATEST(0, (CURRENT_DATE - earliest_due::date))::int AS days_overdue
      FROM overdue
      ORDER BY pending_amount DESC
      LIMIT ${limit}
    `;
  }

  async getOperationalOverdueObligations(asOfDate: Date, ownerId: string, hostelId: string) {
    const cutoff = new Date(Date.UTC(asOfDate.getUTCFullYear(), asOfDate.getUTCMonth(), asOfDate.getUTCDate()));

    return await prisma.$queryRaw<Array<{
      obligation_id: string;
      tenant_id: string;
      owner_id: string;
      hostel_id: string | null;
      allocation_id: string | null;
      rent_month: Date;
      billing_period_start: Date | null;
      billing_period_end: Date | null;
      installment_label: string | null;
      installment_sequence: number | null;
      billing_plan_id: string | null;
      due_date: Date;
      amount: number;
      remaining_amount: number;
      tenant_name: string | null;
      personal_email: string | null;
      phone: string | null;
      late_fee: number;
      total_amount: number;
      access_mode: string | null;
    }>>`
      SELECT
        o.id                                                AS obligation_id,
        o.tenant_id,
        o.owner_id,
        o.hostel_id                                         AS hostel_id,
        o.allocation_id,
        o.rent_month,
        o.billing_period_start,
        o.billing_period_end,
        o.installment_label,
        o.installment_sequence,
        o.billing_plan_id,
        o.due_date,
        o.total_amount::float                               AS amount,
        o.late_fee::float                                   AS late_fee,
        o.total_amount::float                               AS total_amount,
        (o.total_amount - COALESCE(pay_agg.total_paid, 0))::float AS remaining_amount,
        CASE WHEN t.profile_id IS NULL THEN t.display_name ELSE p.name END  AS tenant_name,
        t.personal_email,
        CASE WHEN t.profile_id IS NULL THEN t.phone_1 ELSE p.phone END      AS phone,
        t.access_mode                                       AS access_mode
      FROM rent_obligations o
      JOIN tenants t ON t.id = o.tenant_id
      LEFT JOIN profiles p ON p.id = t.profile_id
      LEFT JOIN room_allocations ra ON ra.id = o.allocation_id
      LEFT JOIN rooms r ON r.id = ra.room_id
      LEFT JOIN (
        SELECT obligation_id, SUM(amount_paid)::float AS total_paid
        FROM payments
        GROUP BY obligation_id
      ) pay_agg ON pay_agg.obligation_id = o.id
      WHERE o.status IN ('PENDING', 'PARTIAL')
        AND o.obligation_type = 'RENT'
        AND o.due_date < ${cutoff}::date
        AND o.is_superseded = false
        AND o.total_amount - COALESCE(pay_agg.total_paid, 0) > 0
        AND o.owner_id = ${ownerId}::uuid
        AND o.hostel_id = ${hostelId}::uuid
    `;
  }

  /**
   * RENT obligations that are activated (PENDING/PARTIAL) and NOT yet overdue —
   * due today or within the next `maxBeforeDays` days. Feeds the before-due /
   * due-day reminder pass. Mirrors getOperationalOverdueObligations but for the
   * forward window; `UPCOMING` (future-period, not-yet-activated) rows stay
   * excluded because their due date is not yet actionable.
   */
  async getOperationalUpcomingObligations(asOfDate: Date, ownerId: string, hostelId: string, maxBeforeDays: number) {
    const today = new Date(Date.UTC(asOfDate.getUTCFullYear(), asOfDate.getUTCMonth(), asOfDate.getUTCDate()));
    const horizon = new Date(today.getTime() + Math.max(0, Math.floor(maxBeforeDays)) * 86_400_000);

    return await prisma.$queryRaw<Array<{
      obligation_id: string;
      tenant_id: string;
      owner_id: string;
      hostel_id: string | null;
      allocation_id: string | null;
      rent_month: Date;
      billing_period_start: Date | null;
      billing_period_end: Date | null;
      installment_label: string | null;
      installment_sequence: number | null;
      billing_plan_id: string | null;
      due_date: Date;
      amount: number;
      remaining_amount: number;
      tenant_name: string | null;
      personal_email: string | null;
      phone: string | null;
      late_fee: number;
      total_amount: number;
      access_mode: string | null;
    }>>`
      SELECT
        o.id                                                AS obligation_id,
        o.tenant_id,
        o.owner_id,
        o.hostel_id                                         AS hostel_id,
        o.allocation_id,
        o.rent_month,
        o.billing_period_start,
        o.billing_period_end,
        o.installment_label,
        o.installment_sequence,
        o.billing_plan_id,
        o.due_date,
        o.total_amount::float                               AS amount,
        o.late_fee::float                                   AS late_fee,
        o.total_amount::float                               AS total_amount,
        (o.total_amount - COALESCE(pay_agg.total_paid, 0))::float AS remaining_amount,
        CASE WHEN t.profile_id IS NULL THEN t.display_name ELSE p.name END  AS tenant_name,
        t.personal_email,
        CASE WHEN t.profile_id IS NULL THEN t.phone_1 ELSE p.phone END      AS phone,
        t.access_mode                                       AS access_mode
      FROM rent_obligations o
      JOIN tenants t ON t.id = o.tenant_id
      LEFT JOIN profiles p ON p.id = t.profile_id
      LEFT JOIN (
        SELECT obligation_id, SUM(amount_paid)::float AS total_paid
        FROM payments
        GROUP BY obligation_id
      ) pay_agg ON pay_agg.obligation_id = o.id
      WHERE o.status IN ('PENDING', 'PARTIAL')
        AND o.obligation_type = 'RENT'
        AND o.due_date >= ${today}::date
        AND o.due_date <= ${horizon}::date
        AND o.is_superseded = false
        AND o.total_amount - COALESCE(pay_agg.total_paid, 0) > 0
        AND o.owner_id = ${ownerId}::uuid
        AND o.hostel_id = ${hostelId}::uuid
    `;
  }

  async getHistoricalOutstanding(ownerId: string, hostelId: string) {
    const now = new Date();
    const todayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

    return await prisma.$queryRaw<any[]>`
      SELECT
        COALESCE(SUM(
          o.total_amount - COALESCE(pay_agg.total_paid, 0)
        ), 0)::float                                                                  AS outstanding_total,
        COALESCE(SUM(
          CASE WHEN o.due_date < ${todayUTC}::date
            THEN o.total_amount - COALESCE(pay_agg.total_paid, 0)
            ELSE 0
          END
        ), 0)::float                                                                  AS overdue_total,
        COUNT(
          CASE WHEN o.due_date < ${todayUTC}::date
            AND o.total_amount - COALESCE(pay_agg.total_paid, 0) > 0
          THEN 1 END
        )::int                                                                        AS overdue_count
      FROM rent_obligations o
      LEFT JOIN (
        SELECT obligation_id, SUM(amount_paid)::float AS total_paid
        FROM payments
        GROUP BY obligation_id
      ) pay_agg ON pay_agg.obligation_id = o.id
      WHERE o.owner_id = ${ownerId}::uuid
        AND o.hostel_id = ${hostelId}::uuid
        AND o.status   IN ('PENDING', 'PARTIAL')
        AND o.total_amount - COALESCE(pay_agg.total_paid, 0) > 0
    `;
  }

  async getTenantPendingObligations(tenantId: string, ownerId: string | undefined, hostelId: string) {
    return await prisma.rent_obligations.findMany({
      where: {
        tenant_id: tenantId,
        ...(ownerId ? { owner_id: ownerId } : {}),
        hostel_id: hostelId,
        status: { in: PAYABLE_STATUSES },
        is_superseded: false,
      },
      include: {
        payments: { select: { amount_paid: true } },
        room_allocations: { include: { room: { select: { room_no: true } } } },
      },
      orderBy: [{ due_date: "asc" }],
    });
  }
}

export const billingRepository = new BillingRepository();
