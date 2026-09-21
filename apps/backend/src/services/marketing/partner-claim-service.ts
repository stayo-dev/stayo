/**
 * A marketplace partner becoming a real Stayo owner.
 *
 * This is the payoff the whole funnel exists to reach, and it is deliberately
 * an *upgrade* rather than a signup: the listing already exists, the
 * enquiries already exist, and claiming hands both over. Nothing is rebuilt.
 *
 * Wires up `platform-listing-rules.ts`, which has been written and tested
 * since migration 068 but had no caller — `canClaimListing` / `buildClaimUpdate`
 * are used here for the first time.
 */
import { prisma } from "@/lib/db";
import { getLogger } from "@/lib/logger";
import { whatsAppTemplateDeliveryService } from "@/lib/services/notifications/whatsapp-template-delivery";
import {
  buildActivatedPayload,
  isPartnerTemplateApproved,
  partnerTemplateLanguage,
  partnerTemplateName,
} from "@/lib/services/notifications/providers/whatsapp/partner-template-contracts";
import { canClaimListing, buildClaimUpdate } from "./platform-listing-rules";
import { nextDeliveryState } from "./partner-delivery-state";

const logger = getLogger("partner.claim");

export class PartnerClaimError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number
  ) {
    super(message);
  }
}

/**
 * Resolves either kind of bearer token a partner can arrive with.
 *
 * `stayo_partner_listing_live` sends the permanent portal token;
 * `stayo_partner_enquiry_locked` sends the token of the specific enquiry
 * that prompted them, so the activation page can name the student they are
 * unlocking. Both must land somewhere useful.
 */
async function resolvePartnerByToken(token: string) {
  const clean = String(token || "").trim();
  if (!clean) throw new PartnerClaimError("Invalid link", "INVALID_TOKEN", 404);

  const byPortal = await prisma.marketplace_partners.findUnique({
    where: { portal_token: clean },
    include: { listings: true },
  });
  if (byPortal) return { partner: byPortal, delivery: null as any };

  const delivery = await prisma.partner_lead_deliveries.findUnique({
    where: { delivery_token: clean },
    include: { listing: { include: { partner: { include: { listings: true } } } } },
  });
  if (delivery) return { partner: delivery.listing.partner, delivery };

  throw new PartnerClaimError("Invalid or expired link", "INVALID_TOKEN", 404);
}

export class PartnerClaimService {
  /** Public, token-gated context for the activation page. */
  async getActivationContext(token: string) {
    const { partner, delivery } = await resolvePartnerByToken(token);
    const listingIds = partner.listings.map((l: any) => l.id);

    const [held, hostels] = await Promise.all([
      listingIds.length
        ? prisma.partner_lead_deliveries.count({
            where: { partner_listing_id: { in: listingIds }, state: "HELD" },
          })
        : 0,
      listingIds.length
        ? prisma.hostels.findMany({
            where: { id: { in: partner.listings.map((l: any) => l.hostel_id) } },
            select: { id: true, name: true, city: true, public_slug: true },
          })
        : [],
    ]);

    return {
      partner_name: partner.name,
      already_converted: !!partner.converted_owner_id,
      hostels,
      held_enquiries: held,
      /** Present only when they arrived from a locked-enquiry message. */
      unlocking_delivery_id: delivery?.id ?? null,
    };
  }

  /**
   * Hands every listing this partner holds to a real owner account, and
   * releases everything that was withheld.
   *
   * `ownerId` must already exist — account creation stays on the normal
   * owner-signup path so there is exactly one way an owner account comes
   * into being.
   */
  async claim(input: { token: string; ownerId: string }) {
    const { partner } = await resolvePartnerByToken(input.token);

    if (partner.converted_owner_id) {
      throw new PartnerClaimError("This listing has already been claimed.", "ALREADY_CLAIMED", 409);
    }
    if (!partner.listings.length) {
      throw new PartnerClaimError("Nothing to claim.", "NO_LISTINGS", 404);
    }

    const hostelIds = partner.listings.map((l: any) => l.hostel_id);
    const hostels = await prisma.hostels.findMany({
      where: { id: { in: hostelIds } },
      select: { id: true, name: true, listing_source: true, claimed_at: true },
    });

    // Refuses rather than doing something adjacent: moving a hostel a real
    // owner already runs carries tenants, obligations and payouts with it.
    for (const hostel of hostels) {
      const guard = canClaimListing(hostel);
      if (!guard.ok) throw new PartnerClaimError(guard.reason, "NOT_CLAIMABLE", 409);
    }

    const now = new Date();
    const listingIds = partner.listings.map((l: any) => l.id);

    const released = await prisma.$transaction(async (tx: any) => {
      for (const hostel of hostels) {
        await tx.hostels.update({
          where: { id: hostel.id },
          data: buildClaimUpdate(input.ownerId, now),
        });
      }

      /**
       * Everything withheld becomes theirs. `nextDeliveryState` is the only
       * place a transition is decided, so a row in any other state — an
       * already-released one, a failed send — is left exactly as it is.
       */
      const withheld = await tx.partner_lead_deliveries.findMany({
        where: { partner_listing_id: { in: listingIds }, state: "HELD" },
        select: { id: true, state: true },
      });
      const releasable = withheld.filter(
        (d: any) => nextDeliveryState(d.state, "released") === "RELEASED"
      );
      if (releasable.length) {
        await tx.partner_lead_deliveries.updateMany({
          where: { id: { in: releasable.map((d: any) => d.id) } },
          data: { state: "RELEASED", released_at: now, updated_at: now },
        });
      }

      await tx.marketplace_partners.update({
        where: { id: partner.id },
        data: { converted_owner_id: input.ownerId, converted_at: now, updated_at: now },
      });

      return releasable.length;
    });

    logger.info("partner.claimed", {
      partner_id: partner.id,
      owner_id: input.ownerId,
      hostels: hostelIds.length,
      released,
    });

    await this.notifyActivated(partner.name, hostels[0]?.name ?? "your hostel", released, partner.phone);

    return { claimed_hostels: hostelIds, released_enquiries: released };
  }

  /**
   * Fire-and-forget. `stayo_partner_activated` is NOT approved in Meta yet,
   * so this currently fails by design — loudly and by name, rather than
   * pretending a message went out.
   */
  private async notifyActivated(
    ownerName: string,
    hostelName: string,
    releasedCount: number,
    phone: string
  ): Promise<void> {
    const templateName = partnerTemplateName("ACTIVATED");
    if (!isPartnerTemplateApproved("ACTIVATED")) {
      logger.warn("partner.activated.template_not_approved", { template: templateName });
      return;
    }
    await whatsAppTemplateDeliveryService
      .send({
        phone,
        templateName,
        languageCode: partnerTemplateLanguage("ACTIVATED"),
        idempotencyKey: `partner_activated:${phone}:${hostelName}`,
        ...buildActivatedPayload({ ownerName, hostelName, releasedCount }),
      })
      .catch((error: any) => {
        logger.error("partner.activated.send_failed", {
          template: templateName,
          error: String(error?.message || error),
        });
      });
  }
}

export const partnerClaimService = new PartnerClaimService();
