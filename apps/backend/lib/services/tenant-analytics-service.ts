import { prisma } from "../db";
import { logger } from "../logger";

export class TenantAnalyticsService {
  /**
   * 1. PAYMENT BEHAVIOR SCORE
   * Recalculates and updates the tenant's behavior score.
   */
  async calculateTenantScore(tenantId: string): Promise<number> {
    try {
      const threeMonthsAgo = new Date();
      threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

      const obligations = await prisma.rent_obligations.findMany({
        where: {
          tenant_id: tenantId,
          due_date: { gte: threeMonthsAgo },
          status: { not: "WAIVED" },
        },
        include: { payments: true },
      });

      const reminders = await prisma.reminder_logs.count({
        where: { tenant_id: tenantId, sent_at: { gte: threeMonthsAgo } },
      });

      let score = 100;
      let latePayments = 0;
      let totalDelayDays = 0;
      let delayCount = 0;

      for (const obs of obligations) {
        const fullyPaid = obs.status === "PAID";
        let paidAt = null;

        if (fullyPaid && obs.payments.length > 0) {
          // find latest payment date
          const sorted = [...obs.payments].sort((a, b) => b.payment_date.getTime() - a.payment_date.getTime());
          paidAt = sorted[0].payment_date;
        } else if (!fullyPaid && new Date() > obs.due_date) {
          // currently overdue
          paidAt = new Date();
        }

        if (paidAt && paidAt > obs.due_date) {
          const delayDays = Math.ceil((paidAt.getTime() - obs.due_date.getTime()) / (1000 * 60 * 60 * 24));
          if (delayDays > 0) {
            latePayments++;
            totalDelayDays += delayDays;
            delayCount++;
          }
        }
      }

      // -10 for each late payment
      score -= latePayments * 10;

      // -5 for each reminder needed
      score -= reminders * 5;

      // -15 if avg delay > 5 days
      if (delayCount > 0) {
        const avgDelay = totalDelayDays / delayCount;
        if (avgDelay > 5) {
          score -= 15;
        }
      }

      // Clamp between 0-100
      score = Math.max(0, Math.min(100, score));

      await prisma.tenant_behavior_scores.upsert({
        where: { tenant_id: tenantId },
        update: {
          score,
          last_calculated: new Date(),
          metadata: { latePayments, reminders, totalDelayDays, avgDelay: delayCount > 0 ? totalDelayDays / delayCount : 0 },
        },
        create: {
          tenant_id: tenantId,
          score,
          last_calculated: new Date(),
          metadata: { latePayments, reminders, totalDelayDays, avgDelay: delayCount > 0 ? totalDelayDays / delayCount : 0 },
        },
      });

      return score;
    } catch (e: any) {
      logger.error("calculateTenantScore.failed", { tenant_id: tenantId, error: e.message });
      return 100;
    }
  }

  /**
   * 2. TENANT EXIT REASON
   */
  async processExit(tenantId: string, reason: string, notes?: string) {
    const validReasons = ["HIGH_RENT", "LOCATION", "FACILITIES", "PERSONAL", "OTHER"];
    if (!validReasons.includes(reason)) {
      throw Object.assign(new Error("INVALID_EXIT_REASON"), { status: 400 });
    }

    await prisma.$transaction(async (tx) => {
      // End active allocations
      await tx.roomAllocation.updateMany({
        where: { tenant_id: tenantId, is_active: true },
        data: { is_active: false, end_date: new Date() },
      });

      // Update tenant status & exit info
      await tx.tenants.update({
        where: { id: tenantId },
        data: {
          status: "FORMER_TENANT",
          exit_reason: reason,
          exit_notes: notes || null,
          exit_date: new Date(),
        },
      });
    });

    return { ok: true, tenant_id: tenantId, exit_reason: reason };
  }

  /**
   * 3. CONVERSION FUNNEL: Track Reminder -> Payment
   * Called when a payment is created.
   */
  async markReminderConversion(obligationId: string, paymentDate: Date) {
    try {
      // Find latest reminder for this obligation
      const latestReminder = await prisma.reminder_logs.findFirst({
        where: { obligation_id: obligationId },
        orderBy: { sent_at: "desc" },
      });

      if (!latestReminder) return;

      // If within 48 hours
      const diffHours = (paymentDate.getTime() - latestReminder.sent_at.getTime()) / (1000 * 60 * 60);

      if (diffHours >= 0 && diffHours <= 48 && !latestReminder.converted_to_payment) {
        await prisma.reminder_logs.update({
          where: { id: latestReminder.id },
          data: {
            converted_to_payment: true,
            converted_at: paymentDate,
          },
        });
      }
    } catch (e: any) {
      logger.error("markReminderConversion.failed", { obligation_id: obligationId, error: e.message });
    }
  }

  /**
   * Analytics service for Reminder Conversions
   */
  async getReminderConversionStats(ownerId: string) {
    const stats = await prisma.reminder_logs.aggregate({
      where: { tenant: { owner_id: ownerId } },
      _count: { id: true },
    });

    const conversions = await prisma.reminder_logs.aggregate({
      where: { tenant: { owner_id: ownerId }, converted_to_payment: true },
      _count: { id: true },
    });

    const totalSent = stats._count.id;
    const totalConverted = conversions._count.id;

    return {
      reminders_sent: totalSent,
      conversions: totalConverted,
      conversion_rate: totalSent > 0 ? (totalConverted / totalSent) * 100 : 0,
    };
  }

  /**
   * 4. CRON: Recalculate all scores
   */
  async recalculateAllTenantScores(ownerId?: string) {
    const tenants = await prisma.tenants.findMany({
      where: ownerId ? { owner_id: ownerId, status: "ACTIVE" } : { status: "ACTIVE" },
      select: { id: true },
    });

    for (const t of tenants) {
      await this.calculateTenantScore(t.id);
    }

    return { processed: tenants.length };
  }
}

export const tenantAnalyticsService = new TenantAnalyticsService();
