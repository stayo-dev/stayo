export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";
import { prisma } from "@/lib/db";
import { COLLECTION_STRATEGIES } from "@/lib/services/collection-strategy-service";
import { WhatsAppRentReminderTemplate } from "@/lib/services/notifications/providers/whatsapp/types";

function toApiError(error: any) {
  const msg = String(error?.message || "Failed to fetch metadata");
  if (msg.startsWith("FORBIDDEN")) return apiError(msg.split(":")[1]?.trim() || msg, "FORBIDDEN", 403);
  if (msg.startsWith("NOT_FOUND")) return apiError(msg.split(":")[1]?.trim() || msg, "NOT_FOUND", 404);
  return apiError(msg, "ERROR", 500);
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession(req);
  try {
    const scope = resolveOwnerScope(session);
    const hostelId = params.id;

    // Check if verified WhatsApp identity exists
    const whatsappIdentity = await prisma.owner_whatsapp_identities.findFirst({
      where: {
        owner_id: scope.owner_id,
        is_verified: true,
      },
    });

    // Query last reminder log
    const lastWhatsappLog = await prisma.whatsapp_logs.findFirst({
      where: { hostel_id: hostelId },
      orderBy: { created_at: "desc" },
    });

    const lastReminderLog = await prisma.reminder_logs.findFirst({
      where: { hostel_id: hostelId },
      orderBy: { sent_at: "desc" },
    });

    let lastSentAt: Date | null = null;
    if (lastWhatsappLog && lastReminderLog) {
      lastSentAt = lastWhatsappLog.created_at > lastReminderLog.sent_at 
        ? lastWhatsappLog.created_at 
        : lastReminderLog.sent_at;
    } else if (lastWhatsappLog) {
      lastSentAt = lastWhatsappLog.created_at;
    } else if (lastReminderLog) {
      lastSentAt = lastReminderLog.sent_at;
    }

    // Determine health metrics
    const isDegraded = lastWhatsappLog?.status === "FAILED" && 
      (new Date().getTime() - lastWhatsappLog.created_at.getTime()) < 24 * 60 * 60 * 1000;

    const templates = [
      {
        id: "RENT_DUE_REMINDER",
        name: "Rent Due Reminder (Before Due)",
        templateName: "rent_due_reminder_v1",
        body: "Hello *{{Tenant Name}}*, your rent of *₹{{Amount}}* for *{{Rent Month}}* is due in *{{Days Left}}* days (on *{{Due Date}}*). Please pay on time to avoid late fees. - HMS"
      },
      {
        id: "RENT_DUE_TODAY",
        name: "Rent Due Today (Due Day)",
        templateName: "rent_due_today_v1",
        body: "Hello *{{Tenant Name}}*, this is a reminder that your rent of *₹{{Amount}}* for *{{Rent Month}}* is due *TODAY*. Please pay using the app to avoid late fees. - HMS"
      },
      {
        id: "RENT_OVERDUE_REMINDER",
        name: "Rent Overdue Warm (Overdue)",
        templateName: "rent_overdue_warm_v1",
        body: "Hello *{{Tenant Name}}*, your rent of *₹{{Amount}}* for *{{Rent Month}}* was due on *{{Due Date}}* and is now overdue by *{{Days Overdue}}* days. Please make payment as soon as possible. - HMS"
      }
    ];

    return apiResponse({
      whatsappConnected: !!whatsappIdentity,
      whatsappPhone: whatsappIdentity?.phone_number || null,
      templatesApproved: true, // Auto-approved in sandbox
      lastReminderSentAt: lastSentAt?.toISOString() || null,
      nextReminderScheduledAt: "Tomorrow 12:00 AM",
      queueStatus: isDegraded ? "DEGRADED" : "HEALTHY",
      strategies: COLLECTION_STRATEGIES,
      whatsappTemplates: templates,
    });
  } catch (error: any) {
    return toApiError(error);
  }
}
