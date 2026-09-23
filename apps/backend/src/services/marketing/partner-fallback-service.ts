/**
 * The sweep that stops a withheld enquiry from becoming an abandoned student.
 *
 * See `partner-fallback-policy.ts` for why this is a rule rather than a
 * feature. In short: holding an enquiry back is leverage on the owner, and
 * the cost of that leverage is paid by someone looking for a place to live.
 * After the threshold, we pay it instead.
 */
import { prisma } from "@/lib/db";
import { getLogger } from "@/lib/logger";
import { EmailService } from "@/lib/services/email-service";
import { notificationService } from "@/lib/services/notification-service";
import { DISCOVERABLE } from "@/src/services/discovery/discovery-service";
import {
  FALLBACK_THRESHOLD_HOURS,
  buildFallbackMessage,
  isFallbackDue,
  selectAlternatives,
} from "./partner-fallback-policy";

const logger = getLogger("partner.fallback");

/** Enough candidates that `selectAlternatives` has something to drop. */
const CANDIDATE_POOL = 12;

export type SweepResult = {
  considered: number;
  rescued: number;
  skipped: number;
  failed: number;
};

export class PartnerFallbackService {
  async sweep(options: { limit?: number; now?: Date; thresholdHours?: number } = {}): Promise<SweepResult> {
    const now = options.now ?? new Date();
    const thresholdHours = options.thresholdHours ?? FALLBACK_THRESHOLD_HOURS;
    const cutoff = new Date(now.getTime() - thresholdHours * 60 * 60 * 1000);

    const due = await prisma.partner_lead_deliveries.findMany({
      where: { state: "HELD", fallback_at: null, created_at: { lte: cutoff } },
      orderBy: { created_at: "asc" },
      take: Math.max(1, Math.floor(options.limit ?? 200)),
      include: { listing: true },
    });

    const result: SweepResult = { considered: due.length, rescued: 0, skipped: 0, failed: 0 };

    for (const delivery of due) {
      try {
        /**
         * Re-read the row's own state rather than trusting the query that
         * found it. A claim landing between this sweep's read and its write
         * releases the enquiry, and telling a student about alternatives
         * moments after their actual first choice became reachable is worse
         * than saying nothing.
         */
        const fresh = await prisma.partner_lead_deliveries.findUnique({
          where: { id: delivery.id },
          select: { id: true, state: true, created_at: true, fallback_at: true },
        });
        if (!fresh || !isFallbackDue(fresh, { now, thresholdHours })) {
          result.skipped += 1;
          continue;
        }

        const rescued = await this.rescue(delivery, now);
        if (rescued) result.rescued += 1;
        else result.skipped += 1;
      } catch (error: any) {
        result.failed += 1;
        // One student's message failing must not end the sweep for everyone
        // else waiting behind them.
        logger.error("partner.fallback.item_failed", {
          delivery_id: delivery.id,
          error: String(error?.message || error),
        });
      }
    }

    logger.info("partner.fallback.swept", result);
    return result;
  }

  private async rescue(delivery: any, now: Date): Promise<boolean> {
    const [hostel, lead] = await Promise.all([
      prisma.hostels.findUnique({
        where: { id: delivery.listing.hostel_id },
        select: { id: true, name: true, city: true },
      }),
      prisma.visitor_leads.findUnique({
        where: { id: delivery.visitor_lead_id },
        select: { student_name: true, student_email: true, seeker_profile_id: true },
      }),
    ]);
    if (!hostel || !lead) return false;

    /**
     * Alternatives are owner-managed and discoverable by the same predicate
     * the public marketplace uses — never another platform listing, which
     * could be held behind this exact gate too. The point of the rescue is
     * to send them somewhere that will actually answer.
     */
    const candidates = hostel.city
      ? await prisma.hostels.findMany({
          where: {
            ...DISCOVERABLE,
            city: hostel.city,
            listing_source: "OWNER_MANAGED",
            id: { not: hostel.id },
          },
          select: { id: true, name: true, city: true, public_slug: true },
          take: CANDIDATE_POOL,
        })
      : [];

    const alternatives = selectAlternatives(candidates, { excludeHostelId: hostel.id });
    const message = buildFallbackMessage({
      studentName: lead.student_name ?? "",
      hostelName: hostel.name,
      alternatives,
    });

    /**
     * In-app and email. There is no approved WhatsApp template for this and
     * inventing one is not something code can do — so the student is reached
     * on the channels we already have, rather than not reached at all.
     */
    if (lead.seeker_profile_id) {
      await notificationService
        .createNotification(lead.seeker_profile_id, message.subject, message.body, "lead")
        .catch(() => undefined);
    }
    if (lead.student_email) {
      await EmailService.sendEmail(
        lead.student_email,
        message.subject,
        `<p>${message.body.replace(/\n/g, "<br/>")}</p>`
      ).catch(() => undefined);
    }

    /**
     * Stamped whether or not alternatives existed. The stamp records that we
     * stopped leaving them in silence, which is the obligation — not that we
     * found them somewhere, which we cannot guarantee.
     */
    await prisma.partner_lead_deliveries.update({
      where: { id: delivery.id },
      data: { fallback_at: now, updated_at: now },
    });

    logger.info("partner.fallback.rescued", {
      delivery_id: delivery.id,
      alternatives: alternatives.length,
      notified_in_app: !!lead.seeker_profile_id,
      notified_email: !!lead.student_email,
    });
    return true;
  }
}

export const partnerFallbackService = new PartnerFallbackService();
