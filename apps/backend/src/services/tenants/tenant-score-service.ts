import { prisma } from "../../../lib/db";
import { tenantAnalyticsService } from "../../../lib/services/tenant-analytics-service";
import { liveTenancyWhere } from "@/lib/tenancy/active-tenancy";

type TenantTrend = "IMPROVING" | "STABLE" | "DECLINING";

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}

function scoreToGrade(score: number): "EXCELLENT" | "GOOD" | "FAIR" | "NEEDS_ATTENTION" | "HIGH_RISK" {
  if (score >= 90) return "EXCELLENT";
  if (score >= 75) return "GOOD";
  if (score >= 60) return "FAIR";
  if (score >= 40) return "NEEDS_ATTENTION";
  return "HIGH_RISK";
}

function gradeToStatus(grade: ReturnType<typeof scoreToGrade>): string {
  switch (grade) {
    case "EXCELLENT":
      return "Excellent Standing";
    case "GOOD":
      return "Good Standing";
    case "FAIR":
      return "Fair Standing";
    case "NEEDS_ATTENTION":
      return "Building Consistency";
    case "HIGH_RISK":
      return "Needs Support";
    default:
      return "Good Standing";
  }
}

type MonthlyMetrics = {
  latePayments: number;
  reminders: number;
  avgDelayDays: number;
};

function computeMonthlyScore(metrics: MonthlyMetrics): number {
  let score = 100;
  score -= metrics.latePayments * 10;
  score -= metrics.reminders * 5;
  if (metrics.avgDelayDays > 5) score -= 15;
  return clampScore(score);
}

function inferTrend(scores: number[]): TenantTrend {
  if (scores.length < 2) return "STABLE";
  const first = scores[0];
  const last = scores[scores.length - 1];
  const delta = last - first;
  if (delta >= 5) return "IMPROVING";
  if (delta <= -5) return "DECLINING";
  return "STABLE";
}

function monthRange(monthOffset: number): { start: Date; end: Date } {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() - monthOffset;
  const start = new Date(year, month, 1);
  const end = new Date(year, month + 1, 0, 23, 59, 59, 999);
  return { start, end };
}

export class TenantScoreService {
  private readonly scoreStaleMs = 12 * 60 * 60 * 1000;

  async getTenantScoreSummary(profileId: string) {
    const tenant = await prisma.tenants.findFirst({
      where: liveTenancyWhere(profileId),
      select: {
        id: true,
        status: true,
        tenant_behavior_scores: {
          select: {
            score: true,
            last_calculated: true,
            metadata: true,
          },
        },
      },
    });

    if (!tenant) throw new Error("NOT_FOUND: Tenant record not found");

    const lastCalculated = tenant.tenant_behavior_scores?.last_calculated;
    const isStale = !lastCalculated || Date.now() - new Date(lastCalculated).getTime() > this.scoreStaleMs;
    if (isStale && tenant.status === "ACTIVE") {
      await tenantAnalyticsService.calculateTenantScore(tenant.id);
    }

    const refreshed = await prisma.tenant_behavior_scores.findUnique({
      where: { tenant_id: tenant.id },
      select: {
        score: true,
        metadata: true,
        last_calculated: true,
      },
    });

    const score = clampScore(Number(refreshed?.score ?? tenant.tenant_behavior_scores?.score ?? 100));
    const grade = scoreToGrade(score);
    const status = gradeToStatus(grade);

    const metadata = (refreshed?.metadata || tenant.tenant_behavior_scores?.metadata || {}) as any;
    const latePayments = Number(metadata?.latePayments ?? 0);
    const reminders = Number(metadata?.reminders ?? 0);
    const avgDelayDays = Number(metadata?.avgDelay ?? 0);

    const trendScores: number[] = [];
    for (let i = 2; i >= 0; i--) {
      const { start, end } = monthRange(i);
      const [monthlyObligations, monthlyReminders] = await Promise.all([
        prisma.rent_obligations.findMany({
          where: {
            tenant_id: tenant.id,
            due_date: { gte: start, lte: end },
            status: { not: "WAIVED" },
          },
          select: {
            due_date: true,
            status: true,
            payments: {
              select: { payment_date: true },
            },
          },
        }),
        prisma.reminder_logs.count({
          where: { tenant_id: tenant.id, sent_at: { gte: start, lte: end } },
        }),
      ]);
      let monthlyLate = 0;
      let totalDelayDays = 0;
      let delayCount = 0;

      for (const obs of monthlyObligations) {
        const fullyPaid = obs.status === "PAID";
        let paidAt: Date | null = null;
        if (fullyPaid && obs.payments.length > 0) {
          const sorted = [...obs.payments].sort((a, b) => b.payment_date.getTime() - a.payment_date.getTime());
          paidAt = sorted[0].payment_date;
        } else if (!fullyPaid && new Date() > obs.due_date) {
          paidAt = new Date();
        }

        if (paidAt && paidAt > obs.due_date) {
          const delayDays = Math.ceil((paidAt.getTime() - obs.due_date.getTime()) / (1000 * 60 * 60 * 24));
          if (delayDays > 0) {
            monthlyLate += 1;
            totalDelayDays += delayDays;
            delayCount += 1;
          }
        }
      }

      const avgDelay = delayCount > 0 ? totalDelayDays / delayCount : 0;
      trendScores.push(computeMonthlyScore({ latePayments: monthlyLate, reminders: monthlyReminders, avgDelayDays: avgDelay }));
    }

    const trend = inferTrend(trendScores);

    const insights: string[] = [];
    const suggestions: string[] = [];

    if (latePayments === 0) insights.push("Great consistency with on-time payments in recent cycles.");
    else insights.push(`${latePayments} recent payment${latePayments > 1 ? "s were" : " was"} delayed.`);

    if (reminders === 0) insights.push("No reminder nudges were needed recently.");
    else insights.push(`${reminders} reminder${reminders > 1 ? "s were" : " was"} needed before payment.`);

    if (avgDelayDays > 0) {
      insights.push(`Average delay is ${avgDelayDays.toFixed(1)} day${avgDelayDays >= 1.5 ? "s" : ""} recently.`);
    }

    if (latePayments > 0) suggestions.push("Pay before due date to steadily improve your score.");
    if (reminders > 1) suggestions.push("Try paying before reminders are sent to build stronger consistency.");
    if (latePayments === 0 && reminders === 0) suggestions.push("Excellent consistency — keep this streak going!");
    if (trend === "DECLINING") suggestions.push("Small timing improvements this month can quickly move your trend back up.");

    if (suggestions.length === 0) {
      suggestions.push("Continue paying on time to maintain your standing.");
    }

    return {
      score,
      grade,
      trend,
      status,
      insights,
      suggestions,
      updated_at: refreshed?.last_calculated || tenant.tenant_behavior_scores?.last_calculated || null,
    };
  }
}

export const tenantScoreService = new TenantScoreService();
