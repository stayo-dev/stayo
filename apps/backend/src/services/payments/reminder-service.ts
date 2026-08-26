import { randomUUID } from "crypto";
import { prisma } from "@/lib/db";
import { eventSystem } from "@/lib/events";
import { EmailService } from "@/lib/services/email-service";
import { eventLog } from "@/lib/services/event-log-service";
import { resolveRules, calculateSingleRuleFee } from "@/lib/billing/engine";
import { resolvePreferences } from "@/lib/preferences";
import { batchGetHostelContexts, getTenantOperationalContext } from "@/lib/hostel-context";
import { formatMonthYear, formatDate } from "@/lib/format";
import { financialService } from "./financial-service";
import { financialLifecycleService } from "./financial-lifecycle-service";
import { selectReminderForOverdueDay } from "@/lib/services/collection-strategy-service";
import { whatsappReminderDeliveryService } from "@/lib/services/notifications/whatsapp-reminder-delivery";
import { getLogger } from "@/lib/logger";
import { resolveTenantName, resolveTenantPhone } from "@/lib/tenants/tenant-identity";

const logger = getLogger("reminder-service");

type ChannelDeliveryStatus = {
  attempted: boolean;
  sent: boolean;
  skipped: boolean;
  reason?: string;
  error_code?: string;
  error_message?: string;
  log_id?: string;
  provider_message_id?: string | null;
  idempotency_key?: string;
};

type NotificationDeliveryResult = {
  credited: boolean;
  in_app: ChannelDeliveryStatus;
  email: ChannelDeliveryStatus;
  whatsapp: ChannelDeliveryStatus;
};

function emptyChannel(): ChannelDeliveryStatus {
  return { attempted: false, sent: false, skipped: false };
}

export class ReminderService {

  /**
   * Process all pending rent obligations that are past their due date.
   * Send tiered automated reminders and generate late fees organically.
   */
  async processDailyReminders(targetDate?: Date) {
    const today = targetDate || new Date();
    // Neutralize to UTC Midnight for accurate day comparison checks
    const todayMid = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));

    // Canonical source: one hostel partition at a time. No background path may
    // sweep operational state without deterministic hostel scope.
    const hostels = await prisma.hostels.findMany({
      where: { status: "ACTIVE" },
      select: { id: true, owner_id: true },
    });
    const overdueByHostel = await Promise.all(
      hostels.map((hostel) =>
        financialService.getOperationalOverdueObligations(todayMid, hostel.owner_id, hostel.id)
      )
    );
    const overdueOperational = overdueByHostel.flat();
    const obligationIds = overdueOperational.map((o) => o.obligation_id);
    const lastReminders = obligationIds.length > 0
      ? await prisma.reminder_logs.findMany({
          where: { obligation_id: { in: obligationIds } },
          orderBy: { sent_at: "desc" },
          distinct: ["obligation_id"],
        })
      : [];
    const remindersByObligation = new Map(lastReminders.map((r) => [r.obligation_id, r]));

    const hostelIds = Array.from(
      new Set(overdueOperational.map((ob) => (ob as any).hostel_id).filter(Boolean))
    ) as string[];

    // Batch-load all needed hostel contexts in ONE query (replaces N×findFirst calls)
    const hostelContextMap = await batchGetHostelContexts(hostelIds);

    let remindersSent = 0;
    let lateFeesAdded = 0;

    for (const ob of overdueOperational) {
      const ownerId = ob.owner_id;
      if (!ownerId) continue;

      const hostelId: string = (ob as any).hostel_id;
      if (!hostelId) continue;

      const hostelCtx = hostelId ? hostelContextMap.get(hostelId) : undefined;
      // Fallback: if hostel context is missing (inactive/deleted hostel), use empty defaults
      const config = hostelCtx ? hostelCtx.prefs : resolvePreferences(null);

      // Automation Guards (preference-level)
      const autoReminders = config.auto_send_reminders ?? true;
      const autoLateFees = config.auto_apply_late_fees ?? true;

      // Calculate age of the debt
      const dueTime = new Date(Date.UTC(ob.due_date.getFullYear(), ob.due_date.getMonth(), ob.due_date.getDate())).getTime();
      const diffTime = Math.abs(todayMid.getTime() - dueTime);
      const daysOverdue = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      // Fetch the last reminder type sent for this obligation
      const lastReminderType = remindersByObligation.get(ob.obligation_id)?.reminder_type ?? null;
      const reminderTarget = {
        id: ob.obligation_id,
        hostel_id: hostelId,
        hostel_name: hostelCtx?.hostel?.name || "Your Hostel",
        amount: ob.remaining_amount,
        rent_month: ob.rent_month,
        due_date: ob.due_date,
        days_overdue: daysOverdue,
        send_date_key: todayMid.toISOString().slice(0, 10),
        tenant: {
          id: ob.tenant_id,
          owner_id: ob.owner_id,
          personal_email: ob.personal_email,
          profiles: { name: ob.tenant_name, phone: (ob as any).phone },
        },
      };

      try {
        // 1️⃣ Automated Tiered Reminders
        if (autoReminders) {
          const reminderType = selectReminderForOverdueDay(daysOverdue, lastReminderType, config);
          if (reminderType) {
            await this.triggerNotification(reminderTarget, reminderType, config);
            remindersSent++;
          }
        }

        // 2️⃣ Organic Late Fee Generation (Shared Billing Engine)
        if (autoLateFees && ob.allocation_id) {
          const { rules, graceDays, maxCap } = resolveRules(config);
          const effectiveOverdue = Math.max(daysOverdue - graceDays, 0);

          if (rules.length > 0 && effectiveOverdue > 0) {
            // Fetch all existing late fees for this allocation + month to calculate accumulated total
            const existingLateFees = await prisma.rent_obligations.findMany({
              where: {
                allocation_id: ob.allocation_id,
                rent_month: ob.rent_month,
                obligation_type: "LATE_FEE",
              },
              select: { amount: true, created_at: true },
            });
            let accumulatedFees = existingLateFees.reduce((sum: number, lf: any) => sum + Number(lf.amount), 0);

            // Cap already reached → skip all rules
            if (maxCap > 0 && accumulatedFees >= maxCap) continue;

            for (const rule of rules) {
              const afterDays = Number(rule.after_days) || 7;
              if (effectiveOverdue < afterDays) continue;

              if (rule.type === 'per_day') {
                // Per-day: create ONE obligation per day, idempotent via created_at date check
                const existingDailyFee = await prisma.rent_obligations.findFirst({
                  where: {
                    allocation_id: ob.allocation_id,
                    rent_month: ob.rent_month,
                    obligation_type: "LATE_FEE",
                    created_at: {
                      gte: todayMid,
                      lt: new Date(todayMid.getTime() + 86400000),
                    },
                  },
                });

                if (!existingDailyFee) {
                  let feeAmount = calculateSingleRuleFee(rule as any, Number(ob.remaining_amount ?? ob.amount));

                  // Cap check
                  if (maxCap > 0 && accumulatedFees + feeAmount > maxCap) {
                    feeAmount = Math.max(maxCap - accumulatedFees, 0);
                  }

                  if (feeAmount > 0) {
                    try {
                      await prisma.$transaction(async (tx: any) => {
                        const created = await tx.rent_obligations.create({
                          data: {
                            tenant_id: ob.tenant_id,
                            allocation_id: ob.allocation_id,
                            owner_id: ob.owner_id,
                            rent_month: ob.rent_month,
                            amount: feeAmount,
                            total_amount: feeAmount,
                            due_date: todayMid,
                            status: "PENDING",
                            obligation_type: "LATE_FEE",
                            hostel_id: hostelId,
                            billing_period_start: (ob as any).billing_period_start || ob.rent_month,
                            billing_period_end: (ob as any).billing_period_end || ob.rent_month,
                            installment_label: (ob as any).installment_label || null,
                            installment_sequence: (ob as any).installment_sequence || null,
                            billing_plan_id: (ob as any).billing_plan_id || null,
                          },
                        });
                        await financialLifecycleService.activatePayableObligations(tx, {
                          tenantId: ob.tenant_id, ownerId: ob.owner_id, hostelId,
                          obligationIds: [created.id],
                        });
                      });
                      accumulatedFees += feeAmount;
                      lateFeesAdded++;
                      await this.triggerNotification(reminderTarget, "LATE_FEE_ADDED", config);
                      remindersSent++;
                      // Post-commit: notify (cache invalidation + SSE).
                      // Activation itself already happened synchronously above.
                      financialLifecycleService.notifyActivated({
                        tenantId: ob.tenant_id,
                        ownerId: ob.owner_id,
                        hostelId,
                        source: "late_fee_per_day",
                      });
                    } catch (feeErr: any) {
                      if (feeErr?.code === "P2002") {
                        // Idempotent skip — duplicate caught by unique index
                        console.info(`[REMINDER] Duplicate per_day late fee skipped for obligation ${ob.obligation_id}`);
                      } else {
                        throw feeErr;
                      }
                    }
                  }
                }
              } else {
                // One-time fees (flat, percentage): create once per rule per month
                // For single legacy rule: check any LATE_FEE exists
                // For multi-rule: count existing one-time fees vs expected
                const oneTimeRuleCount = rules.filter((r: any) => r.type !== 'per_day').length;
                const existingOneTimeFees = existingLateFees.length;

                const hasThisRuleFee = rules.length <= 1
                  ? existingOneTimeFees > 0
                  : existingOneTimeFees >= oneTimeRuleCount;

                if (!hasThisRuleFee) {
                  let feeAmount = calculateSingleRuleFee(rule as any, Number(ob.remaining_amount ?? ob.amount));

                  // Cap check
                  if (maxCap > 0 && accumulatedFees + feeAmount > maxCap) {
                    feeAmount = Math.max(maxCap - accumulatedFees, 0);
                  }

                  if (feeAmount > 0) {
                    try {
                      await prisma.$transaction(async (tx: any) => {
                        const created = await tx.rent_obligations.create({
                          data: {
                            tenant_id: ob.tenant_id,
                            allocation_id: ob.allocation_id,
                            owner_id: ob.owner_id,
                            rent_month: ob.rent_month,
                            amount: feeAmount,
                            total_amount: feeAmount,
                            due_date: todayMid,
                            status: "PENDING",
                            obligation_type: "LATE_FEE",
                            hostel_id: hostelId,
                            billing_period_start: (ob as any).billing_period_start || ob.rent_month,
                            billing_period_end: (ob as any).billing_period_end || ob.rent_month,
                            installment_label: (ob as any).installment_label || null,
                            installment_sequence: (ob as any).installment_sequence || null,
                            billing_plan_id: (ob as any).billing_plan_id || null,
                          },
                        });
                        await financialLifecycleService.activatePayableObligations(tx, {
                          tenantId: ob.tenant_id, ownerId: ob.owner_id, hostelId,
                          obligationIds: [created.id],
                        });
                      });
                      accumulatedFees += feeAmount;
                      lateFeesAdded++;
                      await this.triggerNotification(reminderTarget, "LATE_FEE_ADDED", config);
                      remindersSent++;
                      // Post-commit: notify (cache invalidation + SSE).
                      // Activation itself already happened synchronously above.
                      financialLifecycleService.notifyActivated({
                        tenantId: ob.tenant_id,
                        ownerId: ob.owner_id,
                        hostelId,
                        source: "late_fee_one_time",
                      });
                    } catch (feeErr: any) {
                      if (feeErr?.code === "P2002") {
                        // Idempotent skip — duplicate caught by unique index
                        console.info(`[REMINDER] Duplicate one-time late fee skipped for obligation ${ob.obligation_id}`);
                      } else {
                        throw feeErr;
                      }
                    }
                  }
                }
              }
            }
          }
        }
      } catch (err: any) {
        console.error(`[REMINDER] Error processing obligation ${ob.obligation_id}:`, err?.message);
      }
    }

    if (remindersSent > 0 || lateFeesAdded > 0) {
      // Trigger live updates to owners dashboard so they see realtime notifications and late fees collected incrementing
      const affectedOwners = Array.from(new Set(overdueOperational.map((ob) => ob.owner_id).filter(Boolean)));

      affectedOwners.forEach(ownerId => {
        if (ownerId) {
          eventSystem.trigger("dashboard_updated", { reason: "reminders_processed", ownerId });
        }
      });
    }

    const summary = {
      evaluated_obligations: overdueOperational.length,
      reminders_sent: remindersSent,
      late_fees_added: lateFeesAdded
    };

    // Write structured audit events
    if (remindersSent > 0) {
      await eventLog.log("REMINDER_SENT", null, {
        evaluated: overdueOperational.length,
        reminders_sent: remindersSent
      });
    }
    if (lateFeesAdded > 0) {
      await eventLog.log("LATE_FEE_APPLIED", null, {
        count: lateFeesAdded
      });
    }

    console.log(`[REMINDER] Processing Complete: ${JSON.stringify(summary)}`);
    return summary;
  }

  /**
   * Manual one-tap reminder triggered by owner from the dashboard.
   * Sends to the oldest unpaid obligation for the tenant.
   * Security: verifies tenant.owner_id === ownerId before sending.
   */
  async sendManualReminder(tenantId: string, ownerId: string): Promise<{
    sent: number;
    tenant_name: string;
    channels?: NotificationDeliveryResult;
  }> {
    const tenant = await prisma.tenants.findFirst({
      where: { id: tenantId, owner_id: ownerId, status: "ACTIVE" },
      select: {
        id: true,
        personal_email: true,
        owner_id: true,
        hostel_id: true,
        display_name: true,
        phone_1: true,
        access_mode: true,
        profiles: { select: { name: true, phone: true } },
      },
    });
    if (!tenant) {
      const err: any = new Error("Tenant not found or access denied");
      err.httpStatus = 404;
      throw err;
    }

    const obligation = await prisma.rent_obligations.findFirst({
      where: {
        tenant_id: tenantId,
        owner_id: ownerId,
        status: { notIn: ["PAID", "WAIVED"] },
        due_date: { lt: new Date() },
      },
      orderBy: { due_date: "asc" },
    });

    if (!obligation) return { sent: 0, tenant_name: resolveTenantName(tenant) };

    const context = await getTenantOperationalContext(tenantId, ownerId, tenant.hostel_id);
    const config = context.prefs;

    const today = new Date();
    const todayMid = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
    const due = obligation.due_date || new Date();
    const dueMid = new Date(Date.UTC(due.getFullYear(), due.getMonth(), due.getDate()));
    const daysOverdue = Math.max(1, Math.ceil((todayMid.getTime() - dueMid.getTime()) / 86400000));

    const channels = await this.triggerNotification({
      ...obligation,
      hostel_id: context.hostel.id,
      hostel_name: context.hostel.name,
      days_overdue: daysOverdue,
      send_date_key: todayMid.toISOString().slice(0, 10),
      tenant,
    }, "WARNING", config);

    eventSystem.trigger("dashboard_updated", { reason: "manual_reminder_sent", ownerId });

    const sent = channels.in_app.sent ||
      channels.email.sent ||
      channels.whatsapp.sent ||
      channels.whatsapp.reason === "DUPLICATE_REMINDER"
      ? 1
      : 0;

    return { sent, tenant_name: resolveTenantName(tenant), channels };
  }

  private async triggerNotification(obligation: any, type: string, config: any): Promise<NotificationDeliveryResult> {
    const tenant = obligation.tenant;
    const ownerId = tenant.owner_id;
    const tenantName = resolveTenantName(tenant);
    const tenantPhone = resolveTenantPhone(tenant);
    const isOwnerManaged = tenant.access_mode === "OWNER_MANAGED";
    const result: NotificationDeliveryResult = {
      credited: false,
      in_app: emptyChannel(),
      email: emptyChannel(),
      whatsapp: emptyChannel(),
    };

    result.credited = true;

    const canEmail = config.reminder_email ?? true;
    const canInApp = config.reminder_in_app ?? true;

    // 1️⃣ In-App Notification
    if (isOwnerManaged) {
      result.in_app = { attempted: false, sent: false, skipped: true, reason: "NO_TENANT_ACCOUNT" };
    } else if (canInApp) {
      result.in_app.attempted = true;
      result.in_app.sent = true;
    } else {
      result.in_app = { attempted: false, sent: false, skipped: true, reason: "IN_APP_DISABLED" };
    }

    // 2️⃣ Email Notification
    if (canEmail && tenant.personal_email) {
      result.email.attempted = true;
      try {
        const mailData = {
          toEmail: tenant.personal_email,
          name: tenantName,
          amount: Number(obligation.amount),
          rentMonth: formatMonthYear(obligation.rent_month, config),
          dueDate: formatDate(obligation.due_date, config),
          type: type as any,
          prefs: config,
        };

        await EmailService.sendReminderBatch(mailData);
        result.email.sent = true;
      } catch (err) {
        result.email.error_code = "EMAIL_SEND_FAILED";
        result.email.error_message = err instanceof Error ? err.message : String(err);
        logger.error("reminder.email.failed", {
          tenant_id: tenant.id,
          owner_id: ownerId,
          error: result.email.error_message,
        });
      }
    } else {
      result.email = {
        attempted: false,
        sent: false,
        skipped: true,
        reason: canEmail ? "TENANT_EMAIL_MISSING" : "EMAIL_DISABLED",
      };
    }

    // 3️⃣ WhatsApp Notification (if enabled)
    // Delivery is intentionally routed through the typed Meta provider service.
    // This keeps ReminderService as the business orchestrator while provider API,
    // idempotency, retries, and delivery logs stay isolated.
    if (!(config.reminder_whatsapp ?? false)) {
      result.whatsapp = { attempted: false, sent: false, skipped: true, reason: "WHATSAPP_DISABLED" };
    } else if (!ownerId) {
      result.whatsapp = { attempted: false, sent: false, skipped: true, reason: "OWNER_MISSING" };
    } else if (!tenantPhone) {
      result.whatsapp = { attempted: false, sent: false, skipped: true, reason: "TENANT_PHONE_MISSING" };
    } else {
      result.whatsapp.attempted = true;
      try {
        if (type === "LATE_FEE_ADDED") {
          result.whatsapp = {
            attempted: false,
            sent: false,
            skipped: true,
            reason: "LATE_FEE_TEMPLATE_OUT_OF_SCOPE",
          };
          logger.info("reminder.whatsapp.skipped", {
            tenant_id: tenant.id,
            owner_id: ownerId,
            reason: "LATE_FEE_TEMPLATE_OUT_OF_SCOPE",
          });
        } else {
          const delivery = await whatsappReminderDeliveryService.sendRentReminder({
            ownerId,
            tenantId: tenant.id,
            hostelId: obligation.hostel_id,
            obligationId: obligation.id,
            phone: tenantPhone,
            tenantName,
            hostelName: obligation.hostel_name || "Your Hostel",
            amount: Number(obligation.amount),
            rentMonth: obligation.rent_month,
            dueDate: obligation.due_date,
            daysOverdue: Number(obligation.days_overdue || 1),
            sendDateKey: obligation.send_date_key || new Date().toISOString().slice(0, 10),
            prefs: config,
          });

          result.whatsapp.sent = Boolean(delivery.sent);
          result.whatsapp.skipped = Boolean(delivery.skipped);
          result.whatsapp.log_id = delivery.logId;
          result.whatsapp.provider_message_id = delivery.providerMessageId;
          result.whatsapp.idempotency_key = delivery.idempotencyKey;
          if (delivery.skipped) {
            result.whatsapp.reason = (delivery as any).reason || "DUPLICATE_REMINDER";
          }
        }
      } catch (err: any) {
        result.whatsapp.sent = false;
        result.whatsapp.error_code = err?.providerCode || err?.code || "WHATSAPP_SEND_FAILED";
        result.whatsapp.error_message = String(err?.message || err).slice(0, 500);
        logger.warn("reminder.whatsapp.failed", {
          tenant_id: tenant.id,
          owner_id: ownerId,
          obligation_id: obligation.id,
          error_code: result.whatsapp.error_code,
          error: result.whatsapp.error_message,
        });
      }
    }

    logger.info("reminder.notification.triggered", {
      type,
      tenant_id: obligation.tenant.id,
      owner_id: ownerId,
      in_app: result.in_app,
      email: {
        attempted: result.email.attempted,
        sent: result.email.sent,
        skipped: result.email.skipped,
        reason: result.email.reason,
        error_code: result.email.error_code,
      },
      whatsapp: {
        attempted: result.whatsapp.attempted,
        sent: result.whatsapp.sent,
        skipped: result.whatsapp.skipped,
        reason: result.whatsapp.reason,
        error_code: result.whatsapp.error_code,
        log_id: result.whatsapp.log_id,
        provider_message_id: result.whatsapp.provider_message_id,
      },
    });

    // `reminder_logs` is escalation state, not just an audit trail: the next
    // reminder's type is chosen from the last row here. Writing one when every
    // channel was skipped would march an unreachable tenant up to FINAL_NOTICE
    // and then silence them forever. Only a delivery counts.
    const deliveredChannel = result.in_app.sent
      ? "IN_APP"
      : result.whatsapp.sent
        ? "WHATSAPP"
        : result.email.sent
          ? "EMAIL"
          : null;

    if (deliveredChannel) {
      await prisma.reminder_logs.create({
        data: {
          id: randomUUID(),
          obligation_id: obligation.id,
          tenant_id: tenant.id,
          reminder_type: type,
          channel: deliveredChannel,
          hostel_id: obligation.hostel_id,
        },
      });
    }

    return result;
  }
}

export const reminderService = new ReminderService();
