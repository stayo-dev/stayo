/**
 * Admin operations on marketplace partners: recording consent, attaching a
 * partner to a Stayo-authored listing, and announcing that it is live.
 *
 * Consent is captured here and nowhere else. A partner row cannot exist
 * without it, which is what keeps the rule in `platform-listing-leads.ts`
 * intact: a listing's contact number is the business's, and only a recorded
 * opt-in turns a person into someone we may message.
 */
import crypto from "crypto";
import { prisma } from "@/lib/db";
import { getLogger } from "@/lib/logger";
import { whatsAppTemplateDeliveryService } from "@/lib/services/notifications/whatsapp-template-delivery";
import {
  buildListingLivePayload,
  isPartnerTemplateApproved,
  partnerTemplateLanguage,
  partnerTemplateName,
} from "@/lib/services/notifications/providers/whatsapp/partner-template-contracts";
import { canMessagePartner } from "./partner-consent";
import { DEFAULT_FREE_QUOTA } from "./partner-quota";

const logger = getLogger("partner.admin");

export const CONSENT_CHANNELS = ["PHONE_CALL", "IN_PERSON", "WHATSAPP_REPLY", "WRITTEN"] as const;

export class PartnerAdminError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number
  ) {
    super(message);
  }
}

export class PartnerAdminService {
  async listPartners() {
    const partners = await prisma.marketplace_partners.findMany({
      orderBy: { created_at: "desc" },
      include: { listings: true },
      take: 200,
    });

    const listingIds = partners.flatMap((p: any) => p.listings.map((l: any) => l.id));
    const counts = listingIds.length
      ? await prisma.partner_lead_deliveries.groupBy({
          by: ["partner_listing_id", "state"],
          where: { partner_listing_id: { in: listingIds } },
          _count: { _all: true },
        })
      : [];

    const byListing = new Map<string, Record<string, number>>();
    for (const row of counts as any[]) {
      const entry = byListing.get(row.partner_listing_id) ?? {};
      entry[row.state] = row._count._all;
      byListing.set(row.partner_listing_id, entry);
    }

    return partners.map((p: any) => {
      const tally = p.listings.reduce(
        (acc: Record<string, number>, l: any) => {
          for (const [state, n] of Object.entries(byListing.get(l.id) ?? {})) {
            acc[state] = (acc[state] ?? 0) + (n as number);
          }
          return acc;
        },
        {} as Record<string, number>
      );
      return {
        id: p.id,
        name: p.name,
        phone: p.phone,
        listings: p.listings.length,
        consent_channel: p.consent_channel,
        consent_at: p.consent_at,
        opted_out_at: p.opted_out_at,
        converted_at: p.converted_at,
        delivered: tally.SENT ?? 0,
        held: tally.HELD ?? 0,
        released: tally.RELEASED ?? 0,
      };
    });
  }

  /**
   * Records the person AND the consent in one step — they are not separable.
   * A partner row without a consent timestamp would be a number we hold and
   * have no permission to use.
   */
  async createPartner(input: {
    name: string;
    phone: string;
    email?: string | null;
    consentChannel: string;
    consentNote?: string | null;
    capturedBy: string;
  }) {
    const name = String(input.name || "").trim();
    const phone = String(input.phone || "").trim();
    if (!name) throw new PartnerAdminError("name is required", "VALIDATION_ERROR", 400);
    if (!phone) throw new PartnerAdminError("phone is required", "VALIDATION_ERROR", 400);
    if (!(CONSENT_CHANNELS as readonly string[]).includes(input.consentChannel)) {
      throw new PartnerAdminError(
        `consent_channel must be one of: ${CONSENT_CHANNELS.join(", ")}`,
        "VALIDATION_ERROR",
        400
      );
    }

    const existing = await prisma.marketplace_partners.findUnique({ where: { phone } });
    if (existing) {
      throw new PartnerAdminError("A partner with this phone already exists", "DUPLICATE", 409);
    }

    return prisma.marketplace_partners.create({
      data: {
        name,
        phone,
        email: input.email?.trim() || null,
        consent_channel: input.consentChannel as any,
        consent_at: new Date(),
        consent_by: input.capturedBy,
        consent_note: input.consentNote?.trim() || null,
        portal_token: crypto.randomBytes(32).toString("hex"),
      },
    });
  }

  /**
   * Attaches a partner to a Stayo-authored listing and, unless told not to,
   * tells them it is live.
   *
   * Refuses a hostel a real owner already runs: that listing's enquiries
   * belong to its owner's dashboard, and routing them to a "partner" would
   * send another business's leads to a third party.
   */
  async attachListing(input: { hostelId: string; partnerId: string; announce?: boolean }) {
    const hostel = await prisma.hostels.findUnique({
      where: { id: input.hostelId },
      select: { id: true, name: true, city: true, listing_source: true, claimed_at: true },
    });
    if (!hostel) throw new PartnerAdminError("Hostel not found", "NOT_FOUND", 404);
    if (String(hostel.listing_source) !== "PLATFORM_LISTED" || hostel.claimed_at) {
      throw new PartnerAdminError(
        "Only an unclaimed Stayo-authored listing can be given a marketplace partner.",
        "NOT_PLATFORM_LISTED",
        409
      );
    }

    const partner = await prisma.marketplace_partners.findUnique({ where: { id: input.partnerId } });
    if (!partner) throw new PartnerAdminError("Partner not found", "NOT_FOUND", 404);

    const existing = await prisma.partner_listings.findUnique({
      where: { hostel_id: input.hostelId },
    });
    if (existing && existing.partner_id !== input.partnerId) {
      throw new PartnerAdminError(
        "This listing already belongs to a different partner.",
        "ALREADY_ATTACHED",
        409
      );
    }

    const listing =
      existing ??
      (await prisma.partner_listings.create({
        data: {
          hostel_id: input.hostelId,
          partner_id: input.partnerId,
          free_quota: DEFAULT_FREE_QUOTA,
        },
      }));

    let announced = false;
    if (input.announce !== false) {
      announced = await this.announceListingLive(partner, hostel);
    }

    return { listing, announced };
  }

  private async announceListingLive(partner: any, hostel: any): Promise<boolean> {
    const guard = canMessagePartner(partner);
    if (!guard.ok) {
      logger.info("partner.listing_live.blocked", { partner_id: partner.id, reason: guard.reason });
      return false;
    }

    const templateName = partnerTemplateName("LISTING_LIVE");
    if (!isPartnerTemplateApproved("LISTING_LIVE")) {
      logger.error("partner.listing_live.template_not_approved", { template: templateName });
      return false;
    }

    try {
      const result = await whatsAppTemplateDeliveryService.send({
        phone: partner.phone,
        templateName,
        languageCode: partnerTemplateLanguage("LISTING_LIVE"),
        idempotencyKey: `partner_listing_live:${partner.id}:${hostel.id}`,
        ...buildListingLivePayload({
          ownerName: partner.name,
          hostelName: hostel.name,
          city: hostel.city ?? "",
          portalToken: partner.portal_token,
        }),
      });
      return !result.skipped;
    } catch (error: any) {
      // Never fatal: the attachment is real and useful whether or not the
      // announcement landed, and an admin can re-send.
      logger.error("partner.listing_live.send_failed", {
        template: templateName,
        error: String(error?.message || error),
      });
      return false;
    }
  }
}

export const partnerAdminService = new PartnerAdminService();
