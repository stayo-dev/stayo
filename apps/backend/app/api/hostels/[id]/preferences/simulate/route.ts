export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";
import { prisma } from "@/lib/db";
import { hostelPolicyService } from "@/lib/services/hostel-policy-service";
import { selectReminderForDay, COLLECTION_STRATEGIES } from "@/lib/services/collection-strategy-service";
import { WhatsAppRentReminderTemplate, renderWhatsAppTemplatePreview } from "@/lib/services/notifications/providers/whatsapp";
import { EmailService } from "@/lib/services/email-service";

function toApiError(error: any) {
  const msg = String(error?.message || "Failed to simulate journey");
  if (msg.startsWith("FORBIDDEN")) return apiError(msg.split(":")[1]?.trim() || msg, "FORBIDDEN", 403);
  if (msg.startsWith("NOT_FOUND")) return apiError(msg.split(":")[1]?.trim() || msg, "NOT_FOUND", 404);
  return apiError(msg, "ERROR", 500);
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession(req);
  try {
    const scope = resolveOwnerScope(session);
    const hostelId = params.id;

    // Get search parameters
    const url = new URL(req.url);
    const previewTenantId = url.searchParams.get("tenantId");

    // Fetch hostel policy
    const policyResponse = await hostelPolicyService.getHostelPolicy(hostelId, scope.owner_id);
    const policy = policyResponse.policy;

    // Resolve tenant context
    let tenantName = "Priya Patel";
    let rentAmount = 8500;
    let roomNumber = "G-4";
    let guardianPhone = "9876543210";

    if (previewTenantId) {
      const dbTenant = await prisma.tenants.findUnique({
        where: { id: previewTenantId },
        include: {
          profiles: true,
          room_allocations: {
            where: { is_active: true },
            include: {
              room: {
                select: { room_no: true },
              },
            },
          },
        },
      });
      if (dbTenant) {
        tenantName = dbTenant.profiles?.name || tenantName;
        rentAmount = dbTenant.monthly_rent ? Number(dbTenant.monthly_rent) : rentAmount;
        roomNumber = dbTenant.room_allocations[0]?.room?.room_no || roomNumber;
        guardianPhone = dbTenant.guardian_phone || guardianPhone;
      }
    } else {
      // Find a sample active tenant in the database to be realistic
      const sampleTenant = await prisma.tenants.findFirst({
        where: { hostel_id: hostelId, status: "ACTIVE" },
        include: {
          profiles: true,
          room_allocations: {
            where: { is_active: true },
            include: {
              room: {
                select: { room_no: true },
              },
            },
          },
        },
      });
      if (sampleTenant) {
        tenantName = sampleTenant.profiles?.name || tenantName;
        rentAmount = sampleTenant.monthly_rent ? Number(sampleTenant.monthly_rent) : rentAmount;
        roomNumber = sampleTenant.room_allocations[0]?.room?.room_no || roomNumber;
        guardianPhone = sampleTenant.guardian_phone || guardianPhone;
      }
    }

    // Resolve rent cycle month and due date relative to today
    const dueDay = policy.billing.due_day; // e.g. 5
    const today = new Date();
    let rentYear = today.getFullYear();
    let rentMonthIndex = today.getMonth();

    if (today.getDate() > dueDay) {
      rentMonthIndex += 1;
      if (rentMonthIndex > 11) {
        rentMonthIndex = 0;
        rentYear += 1;
      }
    }

    const rentMonth = new Date(rentYear, rentMonthIndex, 1);
    const dueDate = new Date(rentYear, rentMonthIndex, dueDay);

    // Resolve strategy parameters
    const remindersConfig = { ...policy.reminders };

    const strategyParam = url.searchParams.get("strategy");
    if (strategyParam) {
      remindersConfig.strategy = strategyParam;
    }

    const beforeParam = url.searchParams.get("beforeDueDays");
    if (beforeParam !== null) {
      remindersConfig.custom_before_due_days = beforeParam ? beforeParam.split(",").map(Number).filter(n => !isNaN(n)) : [];
    }

    const afterParam = url.searchParams.get("afterDueDays");
    if (afterParam !== null) {
      remindersConfig.custom_after_due_days = afterParam ? afterParam.split(",").map(Number).filter(n => !isNaN(n)) : [];
    }

    const repeatParam = url.searchParams.get("repeatInterval");
    if (repeatParam !== null) {
      remindersConfig.repeat_interval = Number(repeatParam) || 0;
    }

    const strategyName = remindersConfig.strategy || "custom";

    let beforeDueDays = remindersConfig.custom_before_due_days || [];
    let afterDueDays = remindersConfig.custom_after_due_days || [];
    let repeatInterval = remindersConfig.repeat_interval || 0;

    if (strategyName !== "custom" && COLLECTION_STRATEGIES[strategyName as keyof typeof COLLECTION_STRATEGIES]) {
      const preset = COLLECTION_STRATEGIES[strategyName as keyof typeof COLLECTION_STRATEGIES];
      beforeDueDays = preset.before_due_days;
      afterDueDays = preset.after_due_days;
      repeatInterval = preset.repeat_interval;
    }

    // Compile timeline offsets (chronological)
    const offsets: { daysOffset: number; date: Date }[] = [];

    // 1. Before Due (negative offsets)
    const uniqueBefore = Array.from(new Set(beforeDueDays)).sort((a, b) => b - a); // e.g. 5 days before, then 3 days before
    uniqueBefore.forEach((d) => {
      const date = new Date(dueDate.getTime() - d * 24 * 60 * 60 * 1000);
      offsets.push({ daysOffset: -d, date });
    });

    // 2. Due Day (0 offset)
    const dueDayEnabled = remindersConfig.enabled; // defaults to true if automation is on
    if (dueDayEnabled) {
      offsets.push({ daysOffset: 0, date: dueDate });
    }

    // 3. After Due (positive offsets)
    const uniqueAfter = Array.from(new Set(afterDueDays)).sort((a, b) => a - b);
    uniqueAfter.forEach((d) => {
      const date = new Date(dueDate.getTime() + d * 24 * 60 * 60 * 1000);
      offsets.push({ daysOffset: d, date });
    });

    // 4. Repeat Overdue
    if (repeatInterval > 0) {
      const startOverdueDay = uniqueAfter.length > 0 ? uniqueAfter[uniqueAfter.length - 1] : 0;
      // Add a few repeats (e.g. 3 repeats)
      for (let i = 1; i <= 3; i++) {
        const d = startOverdueDay + (i * repeatInterval);
        if (d <= 90) { // Safety ceiling
          const date = new Date(dueDate.getTime() + d * 24 * 60 * 60 * 1000);
          offsets.push({ daysOffset: d, date });
        }
      }
    }

    // Map each offset to reminder details and template preview
    const timeline = offsets.map((item) => {
      const { daysOffset, date } = item;
      const formattedDate = date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
      const formattedRentMonth = rentMonth.toLocaleDateString("en-US", { month: "long", year: "numeric" });

      // Determine template and render preview
      let templateKey: WhatsAppRentReminderTemplate;
      let stepName = "";
      let emailType: "DUE_SOON" | "WARNING" | "FINAL_NOTICE" | "LATE_FEE_ADDED";

      if (daysOffset < 0) {
        templateKey = WhatsAppRentReminderTemplate.RENT_DUE_REMINDER;
        stepName = `${Math.abs(daysOffset)} Days Before Due`;
        emailType = "DUE_SOON";
      } else if (daysOffset === 0) {
        templateKey = WhatsAppRentReminderTemplate.RENT_DUE_TODAY;
        stepName = "Due Day";
        emailType = "DUE_SOON";
      } else {
        templateKey = WhatsAppRentReminderTemplate.RENT_OVERDUE_REMINDER;
        stepName = `${daysOffset} Days Overdue`;
        emailType = daysOffset >= 10 ? "FINAL_NOTICE" : "WARNING";
      }

      const variables = {
        tenantName,
        amount: rentAmount,
        daysOverdue: daysOffset,
        dueDate: dueDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
        rentMonth: rentMonth.toLocaleDateString("en-US", { month: "long", year: "numeric" }),
        prefs: {},
      };

      const renderedBody = renderWhatsAppTemplatePreview(templateKey, variables);

      // Render Email preview using backend EmailService
      const emailPreview = EmailService.renderReminderPreview({
        name: tenantName,
        amount: rentAmount,
        rentMonth: rentMonth.toLocaleDateString("en-US", { month: "long", year: "numeric" }),
        dueDate: dueDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
        type: emailType,
      });

      // Construct In-App preview message
      let inAppText = "";
      if (daysOffset < 0) {
        inAppText = `Rent Payment Upcoming: ₹${rentAmount.toLocaleString("en-IN")} due on ${dueDate.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}.`;
      } else if (daysOffset === 0) {
        inAppText = `Rent Due Today: Please clear your ₹${rentAmount.toLocaleString("en-IN")} rent obligation.`;
      } else {
        inAppText = `Rent Overdue: Your rent of ₹${rentAmount.toLocaleString("en-IN")} is overdue by ${daysOffset} days. Please settle.`;
      }

      // Determine channels
      const channels: string[] = [];
      if (remindersConfig.channels.whatsapp) {
        if (daysOffset >= 3 && guardianPhone) {
          channels.push("WhatsApp (Tenant + Guardian)");
        } else {
          channels.push("WhatsApp");
        }
      }
      if (remindersConfig.channels.email) {
        channels.push("Email");
      }
      if (remindersConfig.channels.in_app) {
        channels.push("In-App");
      }

      return {
        daysOffset,
        stepName,
        date: formattedDate,
        templateName: templateKey,
        previews: {
          whatsapp: renderedBody,
          in_app: inAppText,
          email: `Subject: ${emailPreview.subject}\n\n${emailPreview.html}`,
        },
        channels,
      };
    });

    return apiResponse({
      rentMonth: rentMonth.toLocaleDateString("en-US", { month: "long", year: "numeric" }),
      dueDate: dueDate.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }),
      dueDay,
      previewTenant: {
        name: tenantName,
        rentAmount,
        roomNumber,
      },
      timeline,
    });
  } catch (error: any) {
    return toApiError(error);
  }
}
