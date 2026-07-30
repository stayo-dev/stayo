export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/db";
import { briefingEngine } from "@/lib/services/notifications/briefing-engine";
import { MetaWhatsAppProvider } from "@/lib/services/notifications/providers/whatsapp/meta-provider";
import { getLogger } from "@/lib/logger";

const logger = getLogger("cron.daily-briefings");

/**
 * 🕐 CRON — Owner Daily Briefing Scheduler
 * GET /api/cron/daily-briefings
 * 
 * Scheduled daily at 07:30 IST (02:00 UTC).
 * The route still checks the local owner window and skips owners who already
 * have a DELIVERED briefing for the local date.
 * Protected by CRON_SECRET bearer token.
 */
export async function GET(req: NextRequest) {
  // Verify cron secret
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    logger.error("CRON_SECRET not configured");
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startTime = Date.now();
  const summary = {
    processed: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
    stale_identities: 0,
    errors: [] as string[],
  };

  try {
    // 1. Fetch all verified owner WhatsApp identities
    const identities = await prisma.owner_whatsapp_identities.findMany({
      where: {
        is_verified: true,
        phone_number: { not: null },
      },
    });

    const activeOwners = await prisma.profile.findMany({
      where: {
        id: { in: identities.map((identity: { owner_id: string }) => identity.owner_id) },
        role: "OWNER",
        is_active: true,
      },
      select: { id: true },
    });
    const activeOwnerIds = new Set(activeOwners.map((owner: { id: string }) => owner.id));

    for (const identity of identities) {
      if (!identity.phone_number) continue;
      summary.processed++;

      if (!activeOwnerIds.has(identity.owner_id)) {
        summary.skipped++;
        summary.stale_identities++;
        logger.warn("Skipping verified WhatsApp identity without an active owner profile", {
          ownerId: identity.owner_id,
          identityId: identity.id,
        });
        continue;
      }

      try {
        const ownerId = identity.owner_id;

        // 2. Fetch owner's active hostels to determine timezone
        const hostels = await prisma.hostels.findMany({
          where: { owner_id: ownerId, status: { in: ["ACTIVE", "INACTIVE"] } },
        });

        // Fallback to "Asia/Kolkata" if no timezone configured
        const timezone = hostels[0]?.timezone || "Asia/Kolkata";

        // Get current date/time in owner's timezone
        const formatter = new Intl.DateTimeFormat("en-US", {
          timeZone: timezone,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        });

        const parts = formatter.formatToParts(new Date());
        const year = parts.find((p) => p.type === "year")?.value;
        const month = parts.find((p) => p.type === "month")?.value;
        const day = parts.find((p) => p.type === "day")?.value;
        const hourStr = parts.find((p) => p.type === "hour")?.value || "0";
        const minStr = parts.find((p) => p.type === "minute")?.value || "0";

        const localDate = `${year}-${month}-${day}`;
        const hour = parseInt(hourStr, 10);
        const minute = parseInt(minStr, 10);

        // 3. Check if briefing already sent for this local date
        const existingBriefing = await prisma.owner_daily_briefings.findFirst({
          where: {
            owner_id: ownerId,
            local_date: localDate,
            delivery_status: "DELIVERED",
          },
        });

        if (existingBriefing) {
          summary.skipped++;
          continue;
        }

        // 4. Verify send window: 07:30 AM to 10:00 PM local time
        const isAfterStart = hour > 7 || (hour === 7 && minute >= 30);
        const isBeforeEnd = hour < 22;

        if (!isAfterStart || !isBeforeEnd) {
          summary.skipped++;
          continue;
        }

        // 5. Generate briefing
        const briefing = await briefingEngine.generateBriefingForOwner(ownerId, localDate, timezone);

        // 6. Send template via WhatsApp
        const provider = new MetaWhatsAppProvider();
        let deliveryStatus = "FAILED";
        let providerMessageId: string | null = null;
        let providerResponse: any = null;

        try {
          const bodyVars = briefing.template_variables as any;
          const sendResult = await provider.sendTemplate({
            to: identity.phone_number,
            templateName: briefing.template_name,
            language: { code: "en" },
            bodyParameters: [
              bodyVars.ownerName || "Owner",
              bodyVars.date || localDate,
              bodyVars.summary || "Here is your daily briefing.",
            ],
          });

          deliveryStatus = "DELIVERED";
          providerMessageId = sendResult.providerMessageId;
          providerResponse = sendResult.raw;
          summary.sent++;
        } catch (sendErr: any) {
          logger.error("WhatsApp delivery failed", { ownerId, phone: identity.phone_number, error: sendErr.message });
          providerResponse = { error: sendErr.message || String(sendErr) };
          summary.failed++;
          summary.errors.push(`Send error for owner ${ownerId}: ${sendErr.message}`);
        }

        // 7. Update briefing record
        await prisma.owner_daily_briefings.update({
          where: { id: briefing.id },
          data: {
            sent_at: new Date(),
            delivery_status: deliveryStatus,
            updated_at: new Date(),
          },
        });

        // 8. Insert into logs
        await prisma.whatsapp_logs.create({
          data: {
            id: crypto.randomUUID(),
            phone: identity.phone_number,
            template: briefing.template_name,
            template_name: "DAILY_BRIEFING",
            status: deliveryStatus,
            delivery_status: deliveryStatus,
            attempt_count: 1,
            provider_message_id: providerMessageId,
            provider_response: providerResponse || {},
            owner_id: ownerId,
          },
        });
      } catch (ownerErr: any) {
        logger.error("Failed processing owner briefing eligibility", { ownerId: identity.owner_id, error: ownerErr.message });
        summary.failed++;
        summary.errors.push(`Processing error for owner ${identity.owner_id}: ${ownerErr.message}`);
      }
    }

    const durationMs = Date.now() - startTime;
    logger.info("cron_completed", { durationMs, ...summary });

    return NextResponse.json({
      success: true,
      duration_ms: durationMs,
      ...summary,
    });
  } catch (err: any) {
    logger.error("Cron route failed", { error: err.message });
    return NextResponse.json(
      {
        success: false,
        error: err.message || "Failed scheduler run",
      },
      { status: 500 }
    );
  }
}
