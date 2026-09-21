/**
 * What a marketplace partner sees without having a Stayo account.
 *
 * Two surfaces, both bearer-token: the portal (all their listings and
 * enquiries) and a single enquiry (the one that reveals a student's number).
 *
 * The visibility rule lives here and nowhere else: a HELD enquiry shows that
 * it exists and who it is roughly from, and withholds the contact. Telling
 * them nothing would make the gate feel like a malfunction; showing the
 * number would make it pointless.
 */
import { prisma } from "@/lib/db";

export class PartnerPortalError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number
  ) {
    super(message);
  }
}

/** States in which the partner has earned the student's contact details. */
const CONTACT_VISIBLE = new Set(["PENDING", "SENT", "RELEASED"]);

function maskPhone(phone: string | null | undefined): string | null {
  const digits = String(phone ?? "").replace(/\D/g, "");
  if (digits.length < 4) return null;
  return `••••••${digits.slice(-4)}`;
}

/** First name only. Enough to feel like a person, not enough to find them. */
function firstName(name: string | null | undefined): string {
  return String(name ?? "").trim().split(/\s+/)[0] || "A student";
}

export class PartnerPortalService {
  async getPortal(token: string) {
    const clean = String(token || "").trim();
    if (!clean) throw new PartnerPortalError("Invalid link", "INVALID_TOKEN", 404);

    const partner = await prisma.marketplace_partners.findUnique({
      where: { portal_token: clean },
      include: { listings: true },
    });
    if (!partner) throw new PartnerPortalError("Invalid link", "INVALID_TOKEN", 404);

    const listingIds = partner.listings.map((l: any) => l.id);
    const hostelIds = partner.listings.map((l: any) => l.hostel_id);

    const [hostels, deliveries] = await Promise.all([
      hostelIds.length
        ? prisma.hostels.findMany({
            where: { id: { in: hostelIds } },
            select: { id: true, name: true, city: true, public_slug: true },
          })
        : [],
      listingIds.length
        ? prisma.partner_lead_deliveries.findMany({
            where: { partner_listing_id: { in: listingIds } },
            orderBy: { created_at: "desc" },
            take: 100,
          })
        : [],
    ]);

    // `visitor_lead_id` carries no Prisma relation on purpose (see the model
    // comment), so the students are fetched in one separate query rather
    // than N+1 through an include that does not exist.
    const leads = deliveries.length
      ? await prisma.visitor_leads.findMany({
          where: { id: { in: deliveries.map((d: any) => d.visitor_lead_id) } },
          select: { id: true, student_name: true, student_phone: true, created_at: true },
        })
      : [];
    const leadById = new Map(leads.map((l: any) => [l.id, l]));
    const listingById = new Map(partner.listings.map((l: any) => [l.id, l]));
    const hostelById = new Map(hostels.map((h: any) => [h.id, h]));

    return {
      partner_name: partner.name,
      converted: !!partner.converted_owner_id,
      listings: partner.listings.map((l: any) => ({
        hostel: hostelById.get(l.hostel_id) ?? null,
        free_quota: l.free_quota,
        delivered: deliveries.filter(
          (d: any) => d.partner_listing_id === l.id && d.state === "SENT"
        ).length,
      })),
      enquiries: deliveries.map((d: any) => {
        const lead = leadById.get(d.visitor_lead_id);
        const unlocked = CONTACT_VISIBLE.has(d.state);
        const listing = listingById.get(d.partner_listing_id);
        return {
          id: d.id,
          state: d.state,
          received_at: d.created_at,
          hostel_name: hostelById.get(listing?.hostel_id)?.name ?? null,
          student_name: unlocked ? (lead?.student_name ?? null) : firstName(lead?.student_name),
          student_phone: unlocked ? (lead?.student_phone ?? null) : maskPhone(lead?.student_phone),
          /** The one-enquiry link. Withheld while locked — there is nothing to open. */
          token: unlocked ? d.delivery_token : null,
        };
      }),
    };
  }

  async getEnquiry(token: string) {
    const clean = String(token || "").trim();
    if (!clean) throw new PartnerPortalError("Invalid link", "INVALID_TOKEN", 404);

    const delivery = await prisma.partner_lead_deliveries.findUnique({
      where: { delivery_token: clean },
      include: { listing: { include: { partner: true } } },
    });
    if (!delivery) throw new PartnerPortalError("Invalid link", "INVALID_TOKEN", 404);

    const [lead, hostel] = await Promise.all([
      prisma.visitor_leads.findUnique({
        where: { id: delivery.visitor_lead_id },
        select: { student_name: true, student_phone: true, student_email: true, notes: true, created_at: true },
      }),
      prisma.hostels.findUnique({
        where: { id: delivery.listing.hostel_id },
        select: { name: true, city: true },
      }),
    ]);

    const unlocked = CONTACT_VISIBLE.has(delivery.state);

    /**
     * First open only. Re-opening is not a new signal, and overwriting
     * would turn "when did they first look" into "when did they last look" —
     * two different questions, and the first is the one that measures
     * whether the message worked.
     */
    if (unlocked && !delivery.opened_at) {
      await prisma.partner_lead_deliveries
        .update({ where: { id: delivery.id }, data: { opened_at: new Date(), updated_at: new Date() } })
        .catch(() => undefined);
    }

    return {
      state: delivery.state,
      unlocked,
      hostel_name: hostel?.name ?? null,
      received_at: delivery.created_at,
      student: {
        name: unlocked ? (lead?.student_name ?? null) : firstName(lead?.student_name),
        phone: unlocked ? (lead?.student_phone ?? null) : maskPhone(lead?.student_phone),
        email: unlocked ? (lead?.student_email ?? null) : null,
        note: unlocked ? (lead?.notes ?? null) : null,
      },
      partner_name: delivery.listing.partner.name,
    };
  }
}

export const partnerPortalService = new PartnerPortalService();
