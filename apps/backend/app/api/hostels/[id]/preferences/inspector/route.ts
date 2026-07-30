export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";
import { prisma } from "@/lib/db";
import { hostelPolicyService } from "@/lib/services/hostel-policy-service";
import { selectReminderForDay, COLLECTION_STRATEGIES } from "@/lib/services/collection-strategy-service";

function toApiError(error: any) {
  const msg = String(error?.message || "Failed to inspect decisions");
  if (msg.startsWith("FORBIDDEN")) return apiError(msg.split(":")[1]?.trim() || msg, "FORBIDDEN", 403);
  if (msg.startsWith("NOT_FOUND")) return apiError(msg.split(":")[1]?.trim() || msg, "NOT_FOUND", 404);
  return apiError(msg, "ERROR", 500);
}

function formatDateString(d: Date): string {
  return d.toISOString().split("T")[0];
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession(req);
  try {
    const scope = resolveOwnerScope(session);
    const hostelId = params.id;

    const url = new URL(req.url);
    const selectedObligationId = url.searchParams.get("obligationId");

    // 1. Fetch recent rent obligations for dropdown selection
    const obligations = await prisma.rent_obligations.findMany({
      where: {
        hostel_id: hostelId,
        obligation_type: "RENT",
      },
      orderBy: { due_date: "desc" },
      take: 20,
      include: {
        tenants: {
          select: {
            id: true,
            profiles: {
              select: {
                name: true,
                phone: true,
              },
            },
            room_allocations: {
              where: { is_active: true },
              include: {
                room: {
                  select: { room_no: true },
                },
              },
            },
          },
        },
      },
    });

    const options = obligations.map((ob) => ({
      obligationId: ob.id,
      tenantId: ob.tenant_id,
      tenantName: ob.tenants?.profiles?.name || "Tenant",
      roomNumber: ob.tenants?.room_allocations[0]?.room?.room_no || "N/A",
      amount: Number(ob.amount),
      dueDate: ob.due_date.toISOString().split("T")[0],
      status: ob.status,
    }));

    // If no specific obligation selected, auto-select the first one if available
    const activeObligationId = selectedObligationId || options[0]?.obligationId;

    if (!activeObligationId) {
      return apiResponse({
        options,
        history: [],
        selectedObligation: null,
      });
    }

    // 2. Fetch selected obligation details
    const selectedOb = await prisma.rent_obligations.findFirst({
      where: {
        id: activeObligationId,
        hostel_id: hostelId,
      },
      include: {
        tenants: {
          select: {
            profiles: {
              select: { name: true, phone: true },
            },
          },
        },
      },
    });

    if (!selectedOb) {
      return apiError("Obligation not found", "NOT_FOUND", 404);
    }

    // Fetch hostel policy to check strategy presets
    const policyResponse = await hostelPolicyService.getHostelPolicy(hostelId, scope.owner_id);
    const policy = policyResponse.policy;

    // Fetch reminder logs
    const whatsappLogs = await prisma.whatsapp_logs.findMany({
      where: { obligation_id: activeObligationId },
      orderBy: { created_at: "asc" },
    });

    const reminderLogs = await prisma.reminder_logs.findMany({
      where: { obligation_id: activeObligationId },
      orderBy: { sent_at: "asc" },
    });

    // Construct timeline decisions relative to due_date
    const dueDateStr = formatDateString(selectedOb.due_date);
    const paidDate = selectedOb.status === "PAID" ? selectedOb.updated_at : null;
    const today = new Date();
    const todayStr = formatDateString(today);

    // Fetch strategy configs to know what days are scheduled
    const strategyName = policy.reminders.strategy || "custom";
    let beforeDueDays = policy.reminders.custom_before_due_days || [];
    let afterDueDays = policy.reminders.custom_after_due_days || [];

    if (strategyName !== "custom" && COLLECTION_STRATEGIES[strategyName as keyof typeof COLLECTION_STRATEGIES]) {
      const preset = COLLECTION_STRATEGIES[strategyName as keyof typeof COLLECTION_STRATEGIES];
      beforeDueDays = preset.before_due_days;
      afterDueDays = preset.after_due_days;
    }

    const maxBefore = Math.max(...beforeDueDays, 5);
    const maxAfter = Math.max(...afterDueDays, 15);

    const history: any[] = [];
    const dateRange: string[] = [];

    // Calculate dates in YYYY-MM-DD
    const dueDateObj = new Date(selectedOb.due_date);
    const startDate = new Date(dueDateObj.getTime() - maxBefore * 24 * 60 * 60 * 1000);
    const endDate = paidDate && paidDate < today ? new Date(paidDate.getTime() + 24 * 60 * 60 * 1000) : today;

    // Generate date sequence
    let current = new Date(startDate);
    while (current <= endDate) {
      dateRange.push(formatDateString(current));
      current.setDate(current.getDate() + 1);
    }

    // Process decisions day-by-day
    dateRange.forEach((dateStr) => {
      const dateObj = new Date(dateStr);
      const diffTime = dateObj.getTime() - dueDateObj.getTime();
      const daysOffset = Math.round(diffTime / (24 * 60 * 60 * 1000));

      const dateLabel = dateObj.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

      // 1. Check if paid
      if (paidDate && dateStr > formatDateString(paidDate)) {
        history.push({
          evalDate: dateObj.toISOString(),
          offsetDays: daysOffset,
          outcome: "SKIPPED",
          reason: "Already Paid",
          logMessage: `Rent was paid on ${paidDate.toLocaleDateString()}. Automation stopped.`,
          channels: [],
        });
        return;
      }

      // 2. Check if a log was sent on this day
      const dailyWhatsapp = whatsappLogs.find((l) => formatDateString(l.created_at) === dateStr);
      const dailyReminder = reminderLogs.find((l) => formatDateString(l.sent_at) === dateStr);

      if (dailyWhatsapp) {
        const isFailed = dailyWhatsapp.status === "FAILED";
        history.push({
          evalDate: dateObj.toISOString(),
          offsetDays: daysOffset,
          outcome: isFailed ? "FAILED" : "DELIVERED",
          reason: isFailed ? "Failed to Send" : "Delivered",
          logMessage: isFailed
            ? `Failed to send WhatsApp: ${dailyWhatsapp.error_message || "API Error"}`
            : `Reminder delivered via WhatsApp at ${dailyWhatsapp.created_at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.`,
          channels: ["WhatsApp"],
        });
        return;
      }

      if (dailyReminder) {
        history.push({
          evalDate: dateObj.toISOString(),
          offsetDays: daysOffset,
          outcome: "DELIVERED",
          reason: "Delivered",
          logMessage: `Reminder sent via ${dailyReminder.channel} at ${dailyReminder.sent_at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.`,
          channels: [dailyReminder.channel],
        });
        return;
      }

      // 3. No log. Was it scheduled?
      const resolvedReminder = selectReminderForDay(daysOffset, policy.reminders);
      if (!resolvedReminder) {
        history.push({
          evalDate: dateObj.toISOString(),
          offsetDays: daysOffset,
          outcome: "SKIPPED",
          reason: "Not Scheduled",
          logMessage: `No reminder scheduled for day ${daysOffset}.`,
          channels: [],
        });
        return;
      }

      // Scheduled but not sent
      if (dateStr > todayStr) {
        history.push({
          evalDate: dateObj.toISOString(),
          offsetDays: daysOffset,
          outcome: "QUEUED",
          reason: "Pending",
          logMessage: `Scheduled to trigger on ${dateLabel}.`,
          channels: [],
        });
      } else if (dateStr === todayStr) {
        history.push({
          evalDate: dateObj.toISOString(),
          offsetDays: daysOffset,
          outcome: "QUEUED",
          reason: "Pending",
          logMessage: "Waiting for the daily execution engine.",
          channels: [],
        });
      } else {
        history.push({
          evalDate: dateObj.toISOString(),
          offsetDays: daysOffset,
          outcome: "SKIPPED",
          reason: "Not Processed",
          logMessage: `Scheduled but not processed (e.g. engine skipped or cron schedule mismatch).`,
          channels: [],
        });
      }
    });

    return apiResponse({
      options,
      selectedObligation: {
        id: selectedOb.id,
        tenantName: selectedOb.tenants?.profiles?.name || "Tenant",
        amount: Number(selectedOb.amount),
        dueDate: dueDateStr,
        status: selectedOb.status,
        paidAt: selectedOb.status === "PAID" ? selectedOb.updated_at.toISOString() : null,
        lateFeesApplied: Number(selectedOb.late_fee || 0),
      },
      history: history.reverse(), // Show newest first
    });
  } catch (error: any) {
    return toApiError(error);
  }
}
