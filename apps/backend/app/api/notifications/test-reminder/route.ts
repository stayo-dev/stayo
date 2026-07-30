export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { EmailService } from "@/lib/services/email-service";
import { prisma } from "@/lib/db";
import { eventLog } from "@/lib/services/event-log-service";
import { formatMonthYear } from "@/lib/format";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";
import { hostelPolicyService } from "@/lib/services/hostel-policy-service";
import { MetaWhatsAppProvider } from "@/lib/services/notifications/providers/whatsapp/meta-provider";
import {
  selectRentReminderTemplate,
  getMetaTemplateName,
  getMetaTemplateLanguage,
  buildRentReminderBodyParameters,
} from "@/lib/services/notifications/providers/whatsapp/templates";

/**
 * 🔔 TEST REMINDER
 * POST /api/notifications/test-reminder
 *
 * Sends a test reminder email or WhatsApp template to the owner themselves.
 * Body: { type: string, hostelId: string, channel?: "email" | "whatsapp", destination?: string }
 */
export async function POST(req: NextRequest) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  try {
    const scope = resolveOwnerScope(session);
    const body = await req.json().catch(() => ({}));
    const reminderType = body.type || "DUE_SOON";
    const hostelId = body.hostel_id || body.hostelId;
    const channel = body.channel || "email";
    const destination = body.destination || "";

    if (!hostelId) {
      return apiError("hostelId is required for test reminders", "HOSTEL_CONTEXT_REQUIRED", 400);
    }

    const validTypes = ["DUE_SOON", "WARNING", "FINAL_NOTICE", "LATE_FEE_ADDED", "DUE_TODAY", "OVERDUE"];
    if (!validTypes.includes(reminderType)) {
      return apiError(
        `Invalid type. Must be one of: ${validTypes.join(", ")}`,
        "VALIDATION_ERROR",
        400
      );
    }

    // Fetch owner profile
    const profile = await prisma.profile.findUnique({
      where: { id: scope.owner_id },
      select: { name: true, email: true },
    });

    if (!profile) {
      return apiError("Owner profile not found", "NOT_FOUND", 404);
    }

    const policyResult = await hostelPolicyService.getHostelPolicy(hostelId, scope.owner_id);
    const prefs = policyResult.compatibility_preferences;
    const dueDay = prefs.due_day;
    const now = new Date();
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const monthLabel = formatMonthYear(nextMonth, prefs);

    if (channel === "whatsapp") {
      let targetPhone = destination;
      if (!targetPhone) {
        const whatsappIdentity = await prisma.owner_whatsapp_identities.findFirst({
          where: { owner_id: scope.owner_id, is_verified: true },
          select: { phone_number: true },
        });
        if (whatsappIdentity?.phone_number) {
          targetPhone = whatsappIdentity.phone_number;
        }
      }

      if (!targetPhone) {
        return apiError(
          "No verified WhatsApp phone number found. Please specify a destination phone number.",
          "WHATSAPP_NOT_CONFIGURED",
          400
        );
      }

      let daysOverdue = 5;
      if (reminderType === "DUE_SOON") {
        daysOverdue = -3;
      } else if (reminderType === "DUE_TODAY") {
        daysOverdue = 0;
      }

      const tempVars = {
        obligationId: "test-ob-123",
        tenantName: profile.name || "Test Tenant",
        hostelName: "Test Hostel",
        amount: 8000,
        rentMonth: nextMonth,
        dueDate: now,
        daysOverdue,
        prefs,
      };

      const template = selectRentReminderTemplate(daysOverdue);
      const templateName = getMetaTemplateName(template);
      const languageCode = getMetaTemplateLanguage(template);
      const bodyParameters = buildRentReminderBodyParameters(tempVars);

      try {
        const provider = new MetaWhatsAppProvider();
        const result = await provider.sendTemplate({
          to: targetPhone,
          templateName,
          language: { code: languageCode },
          bodyParameters,
          buttonParameters: ["test-token"],
        });

        await eventLog.log("TEST_REMINDER_SENT", scope.owner_id, {
          hostel_id: hostelId,
          type: reminderType,
          channel: "whatsapp",
          phone: targetPhone,
          sent: true,
        });

        return apiResponse({
          success: true,
          message: `Test WhatsApp template '${templateName}' sent to ${targetPhone}`,
          provider_id: result.providerMessageId,
        });
      } catch (error: any) {
        console.error("[TEST_REMINDER] WhatsApp send failed:", error);
        return apiResponse({
          success: false,
          message: `WhatsApp could not be delivered: ${error.message || error}`,
          simulation: !process.env.WHATSAPP_ACCESS_TOKEN && !process.env.WHATSAPP_TOKEN,
        }, 200);
      }
    } else {
      // Email channel
      const targetEmail = destination || profile.email;
      if (!targetEmail) {
        return apiError("No email found for your account", "NOT_FOUND", 404);
      }

      // Map types for email compatibility
      let emailType = reminderType;
      if (emailType === "DUE_TODAY") emailType = "DUE_SOON";
      if (emailType === "OVERDUE") emailType = "WARNING";

      const result = await EmailService.sendReminderBatch({
        toEmail: targetEmail,
        name: profile.name,
        amount: 8000,
        rentMonth: monthLabel,
        dueDate: `${dueDay} ${monthLabel}`,
        type: emailType as any,
        prefs,
      });

      await eventLog.log("TEST_REMINDER_SENT", scope.owner_id, {
        hostel_id: hostelId,
        type: reminderType,
        channel: "email",
        email: targetEmail,
        sent: result.sent,
      });

      if (!result.sent) {
        return apiResponse({
          success: false,
          message: `Email could not be delivered: ${result.error}`,
          simulation: !process.env.RESEND_API_KEY,
        }, 200);
      }

      return apiResponse({
        success: true,
        message: `Test email sent to ${targetEmail}`,
        provider_id: result.provider_id,
      });
    }
  } catch (error: any) {
    console.error("[TEST_REMINDER] Failed:", error);
    return apiError(error.message || "Failed to send test reminder");
  }
}
