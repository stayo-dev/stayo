export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { reminderService } from "@/src/services/payments/reminder-service";
import { eventLog } from "@/lib/services/event-log-service";
import { getLogger } from "@/lib/logger";

const logger = getLogger("api.notifications.send-reminder");

/**
 * 🔔 MANUAL REMINDER
 * POST /api/notifications/send-reminder
 *
 * Owner-triggered one-tap reminder from the dashboard.
 * Sends a WARNING reminder to the tenant's oldest unpaid obligation.
 * Deducts one reminder credit per call (same as automated reminders).
 *
 * Body: { tenant_id: string }
 */
export async function POST(req: NextRequest) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  try {
    const body = await req.json().catch(() => ({}));
    const { tenant_id } = body;

    if (!tenant_id || typeof tenant_id !== "string") {
      return apiError("tenant_id is required", "VALIDATION_ERROR", 400);
    }

    const result = await reminderService.sendManualReminder(tenant_id, session.sub);

    if (result.sent === 0) {
      return apiResponse({
        success: false,
        message: `No unpaid obligations found for ${result.tenant_name}`,
        tenant_name: result.tenant_name,
        channels: result.channels,
      });
    }

    await eventLog.log("MANUAL_REMINDER_SENT", session.sub, {
      tenant_id,
      tenant_name: result.tenant_name,
      channels: result.channels,
    });

    const whatsapp = result.channels?.whatsapp;
    const message = whatsapp?.sent
      ? `WhatsApp reminder sent to ${result.tenant_name}`
      : whatsapp?.skipped
        ? `Reminder recorded for ${result.tenant_name}; WhatsApp skipped (${whatsapp.reason || "unknown"})`
        : whatsapp?.attempted
          ? `Reminder recorded for ${result.tenant_name}; WhatsApp failed (${whatsapp.error_code || "WHATSAPP_SEND_FAILED"})`
          : `Reminder sent to ${result.tenant_name}`;

    return apiResponse({
      success: true,
      message,
      tenant_name: result.tenant_name,
      channels: result.channels,
    });
  } catch (error: any) {
    if (error?.httpStatus === 404) {
      return apiError(error.message, "NOT_FOUND", 404);
    }
    logger.error("send_reminder.failed", {
      error: error?.message || String(error),
      code: error?.code,
    });
    return apiError(error.message || "Failed to send reminder");
  }
}
