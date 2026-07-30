import { prisma } from "../db";

/**
 * ActivationAnalyticsService
 *
 * Admin-facing funnel metrics for onboarding conversion optimization.
 * All queries are read-only aggregates — never modifies state.
 *
 * Powers:
 *   - Admin onboarding funnel dashboard
 *   - Activation conversion tracking
 *   - Abandonment stage analysis
 *   - Time-to-value measurements
 */
export class ActivationAnalyticsService {

  /**
   * Full onboarding funnel metrics.
   * Returns counts at each step + conversion rates.
   */
  async getFunnelMetrics(fromDate?: Date, toDate?: Date): Promise<{
    total_registered:          number;
    completed_onboarding:      number;
    completion_rate_pct:       number;
    avg_time_to_completion_hrs: number | null;
    abandonment_by_step:       { step: string; count: number; pct: number }[];
    step_counts:               { step: string; count: number }[];
  }> {
    const where: any = {};
    if (fromDate) where.created_at = { gte: fromDate };
    if (toDate)   where.created_at = { ...(where.created_at ?? {}), lte: toDate };

    const [allRows, completedRows] = await Promise.all([
      (prisma as any).ownerOnboardingState.groupBy({
        by:     ["onboarding_step"],
        where,
        _count: { owner_id: true },
      }),
      (prisma as any).ownerOnboardingState.findMany({
        where: { ...where, onboarding_completed_at: { not: null } },
        select: { created_at: true, onboarding_completed_at: true },
      }),
    ]);

    const totalRegistered = await prisma.profile.count({
      where: { role: "OWNER", ...(fromDate ? { created_at: { gte: fromDate } } : {}) },
    });

    const stepCounts: { step: string; count: number }[] = allRows.map((r: any) => ({
      step:  r.onboarding_step,
      count: r._count.owner_id,
    }));

    const completedCount = completedRows.length;
    const completionRate = totalRegistered > 0
      ? Math.round((completedCount / totalRegistered) * 100)
      : 0;

    // Average time-to-completion in hours
    let avgTimeHrs: number | null = null;
    if (completedRows.length > 0) {
      const totalMs = completedRows.reduce((sum: number, r: any) => {
        const diff = new Date(r.onboarding_completed_at).getTime() - new Date(r.created_at).getTime();
        return sum + diff;
      }, 0);
      avgTimeHrs = Math.round((totalMs / completedRows.length / 3600000) * 10) / 10;
    }

    // Abandonment by step (owners who are stuck at each step and not completed)
    const abandonmentByStep = stepCounts
      .filter(s => s.step !== "COMPLETED")
      .map(s => ({
        step:  s.step,
        count: s.count,
        pct:   totalRegistered > 0 ? Math.round((s.count / totalRegistered) * 100) : 0,
      }))
      .sort((a, b) => b.count - a.count);

    return {
      total_registered:           totalRegistered,
      completed_onboarding:       completedCount,
      completion_rate_pct:        completionRate,
      avg_time_to_completion_hrs: avgTimeHrs,
      abandonment_by_step:        abandonmentByStep,
      step_counts:                stepCounts,
    };
  }

  /**
   * Operational activation milestones funnel.
   * Tracks how many owners have reached each business milestone.
   */
  async getActivationMilestones(): Promise<{
    milestone:     string;
    description:   string;
    count:         number;
    pct_of_registered: number;
  }[]> {
    const totalOwners = await prisma.profile.count({ where: { role: "OWNER" } });

    const [
      hostelCount,
      billingCount,
      roomCount,
      tenantCount,
      rentGenCount,
      paymentCount,
    ] = await Promise.all([
      prisma.hostels.count({ where: { status: { in: ["ACTIVE", "INACTIVE"] } } }),
      prisma.hostels.count({ where: { status: { in: ["ACTIVE", "INACTIVE"] }, auto_rent_day: { gt: 0 } } }),
      // Owners with at least 1 room
      prisma.$queryRaw<{count: bigint}[]>`
        SELECT COUNT(DISTINCT h.owner_id) AS count
        FROM rooms r JOIN hostels h ON h.id = r.hostel_id
        WHERE r.is_active = true`,
      // Owners with at least 1 active tenant
      prisma.$queryRaw<{count: bigint}[]>`
        SELECT COUNT(DISTINCT owner_id) AS count
        FROM tenants WHERE status = 'ACTIVE'`,
      // Owners with at least 1 successful rent generation
      prisma.$queryRaw<{count: bigint}[]>`
        SELECT COUNT(DISTINCT owner_id) AS count
        FROM rent_generation_ledgers
        WHERE status = 'COMPLETED' AND created_count > 0`,
      // Owners with at least 1 payment recorded
      prisma.$queryRaw<{count: bigint}[]>`
        SELECT COUNT(DISTINCT owner_id) AS count
        FROM payments WHERE owner_id IS NOT NULL`,
    ]);

    const pct = (n: number) =>
      totalOwners > 0 ? Math.round((n / totalOwners) * 100) : 0;

    const roomOwners    = Number((roomCount[0] as any)?.count ?? 0);
    const tenantOwners  = Number((tenantCount[0] as any)?.count ?? 0);
    const rentOwners    = Number((rentGenCount[0] as any)?.count ?? 0);
    const payOwners     = Number((paymentCount[0] as any)?.count ?? 0);

    return [
      { milestone: "REGISTERED",       description: "Owners registered",                    count: totalOwners,   pct_of_registered: 100 },
      { milestone: "HOSTEL_CREATED",   description: "Hostel created",                       count: hostelCount,   pct_of_registered: pct(hostelCount) },
      { milestone: "BILLING_READY",    description: "Billing automation configured",        count: billingCount,  pct_of_registered: pct(billingCount) },
      { milestone: "ROOM_ADDED",       description: "At least 1 room added",                count: roomOwners,    pct_of_registered: pct(roomOwners) },
      { milestone: "TENANT_ADDED",     description: "At least 1 active tenant",             count: tenantOwners,  pct_of_registered: pct(tenantOwners) },
      { milestone: "RENT_GENERATED",   description: "First rent cycle generated",           count: rentOwners,    pct_of_registered: pct(rentOwners) },
      { milestone: "FIRST_PAYMENT",    description: "First payment collected",              count: payOwners,     pct_of_registered: pct(payOwners) },
    ];
  }

  /**
   * Time-to-value metrics.
   * How long (median / avg) does it take owners to reach key milestones
   * from registration date?
   */
  async getTimeToValue(): Promise<{
    metric: string;
    avg_hours: number | null;
    median_hours: number | null;
  }[]> {
    // Time from profile.created_at → first hostel created
    const [ttHostel, ttTenant, ttRent, ttPayment] = await Promise.all([
      prisma.$queryRaw<{avg_hours: number | null; median_hours: number | null}[]>`
        SELECT
          AVG(EXTRACT(EPOCH FROM (h.created_at - p.created_at)) / 3600)::float AS avg_hours,
          PERCENTILE_CONT(0.5) WITHIN GROUP (
            ORDER BY EXTRACT(EPOCH FROM (h.created_at - p.created_at)) / 3600
          )::float AS median_hours
        FROM hostels h JOIN profiles p ON p.id = h.owner_id
        WHERE h.status IN ('ACTIVE', 'INACTIVE')`,
      prisma.$queryRaw<{avg_hours: number | null; median_hours: number | null}[]>`
        SELECT
          AVG(EXTRACT(EPOCH FROM (t.created_at - p.created_at)) / 3600)::float AS avg_hours,
          PERCENTILE_CONT(0.5) WITHIN GROUP (
            ORDER BY EXTRACT(EPOCH FROM (t.created_at - p.created_at)) / 3600
          )::float AS median_hours
        FROM (
          SELECT owner_id, MIN(created_at) AS created_at FROM tenants
          WHERE status = 'ACTIVE' GROUP BY owner_id
        ) t JOIN profiles p ON p.id = t.owner_id`,
      prisma.$queryRaw<{avg_hours: number | null; median_hours: number | null}[]>`
        SELECT
          AVG(EXTRACT(EPOCH FROM (rgl.created_at - p.created_at)) / 3600)::float AS avg_hours,
          PERCENTILE_CONT(0.5) WITHIN GROUP (
            ORDER BY EXTRACT(EPOCH FROM (rgl.created_at - p.created_at)) / 3600
          )::float AS median_hours
        FROM (
          SELECT owner_id, MIN(created_at) AS created_at FROM rent_generation_ledgers
          WHERE status = 'COMPLETED' AND created_count > 0 GROUP BY owner_id
        ) rgl JOIN profiles p ON p.id = rgl.owner_id`,
      prisma.$queryRaw<{avg_hours: number | null; median_hours: number | null}[]>`
        SELECT
          AVG(EXTRACT(EPOCH FROM (pay.created_at - p.created_at)) / 3600)::float AS avg_hours,
          PERCENTILE_CONT(0.5) WITHIN GROUP (
            ORDER BY EXTRACT(EPOCH FROM (pay.created_at - p.created_at)) / 3600
          )::float AS median_hours
        FROM (
          SELECT owner_id, MIN(created_at) AS created_at FROM payments
          WHERE owner_id IS NOT NULL GROUP BY owner_id
        ) pay JOIN profiles p ON p.id = pay.owner_id`,
    ]);

    const round2 = (n: number | null) => n !== null ? Math.round(n * 10) / 10 : null;

    return [
      { metric: "TIME_TO_FIRST_HOSTEL",   avg_hours: round2(ttHostel[0]?.avg_hours),   median_hours: round2(ttHostel[0]?.median_hours) },
      { metric: "TIME_TO_FIRST_TENANT",   avg_hours: round2(ttTenant[0]?.avg_hours),   median_hours: round2(ttTenant[0]?.median_hours) },
      { metric: "TIME_TO_FIRST_RENT",     avg_hours: round2(ttRent[0]?.avg_hours),     median_hours: round2(ttRent[0]?.median_hours) },
      { metric: "TIME_TO_FIRST_PAYMENT",  avg_hours: round2(ttPayment[0]?.avg_hours),  median_hours: round2(ttPayment[0]?.median_hours) },
    ];
  }
}

export const activationAnalyticsService = new ActivationAnalyticsService();
