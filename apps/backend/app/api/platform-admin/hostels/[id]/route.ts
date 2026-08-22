export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { prisma } from "@/lib/db";

function requireAdmin(session: any) {
  if (!session || session.role !== "ADMIN") {
    throw new Error("FORBIDDEN: Admin access only");
  }
}

/**
 * GET /api/platform-admin/hostels/[id]
 * Full detail for the Hostels tab's detail view.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  const { id } = await params;

  try {
    requireAdmin(session);

    const hostel = await prisma.hostels.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        city: true,
        state: true,
        pincode: true,
        address: true,
        phone: true,
        verification_status: true,
        listing_status: true,
        created_at: true,
        owner_id: true,
        profiles: { select: { name: true, email: true, phone: true } },
        _count: { select: { tenants: true, rooms: true } },
        hostel_subscriptions: { include: { subscription_plans: true } },
      },
    });
    if (!hostel) return apiError("Hostel not found", "NOT_FOUND", 404);

    // Every other hostel this same owner runs — lets the admin see the full
    // picture for one person/owner_id rather than one hostel in isolation.
    const siblingHostels = await prisma.hostels.findMany({
      where: { owner_id: hostel.owner_id, id: { not: id } },
      select: { id: true, name: true, city: true, listing_status: true },
      orderBy: { created_at: "desc" },
    });

    const [activeTenants, revenue, dues, capacity] = await Promise.all([
      prisma.tenants.count({ where: { hostel_id: id, status: "ACTIVE" } }),
      prisma.payments.aggregate({
        where: { hostel_id: id, payment_date: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) } },
        _sum: { amount_paid: true },
      }),
      prisma.rent_obligations.aggregate({
        where: { hostel_id: id, status: { in: ["PENDING", "PARTIAL", "OVERDUE"] } },
        _sum: { amount: true },
      }),
      prisma.rooms.aggregate({ where: { hostel_id: id }, _sum: { capacity: true } }),
    ]);

    // What the console needs to know before offering "Request changes" or
    // "Unpublish": whether anything is actually live, and whether a submission
    // is already sitting in the queue. Offering the buttons blind and letting
    // the server 409 works, but tells the admin nothing until they have clicked.
    const [liveRevision, openRevision] = await Promise.all([
      prisma.hostel_marketing_revisions.findFirst({
        where: { hostel_id: id, status: "APPROVED" },
        select: { id: true, version: true, reviewed_at: true },
      }),
      prisma.hostel_marketing_revisions.findFirst({
        where: { hostel_id: id, status: { in: ["DRAFT", "PENDING_REVIEW"] } },
        select: { status: true },
      }),
    ]);

    return apiResponse({
      hostel: {
        id: hostel.id,
        name: hostel.name,
        city: hostel.city,
        state: hostel.state,
        pincode: hostel.pincode,
        address: hostel.address,
        phone: hostel.phone,
        verification_status: hostel.verification_status,
        listing_status: hostel.listing_status,
        created_at: hostel.created_at,
        owner: hostel.profiles,
        owner_id: hostel.owner_id,
        owner_hostel_count: siblingHostels.length + 1,
        sibling_hostels: siblingHostels,
        tenants: activeTenants,
        rooms: hostel._count.rooms,
        capacity: Number(capacity._sum.capacity ?? 0),
        occupancy: Number(capacity._sum.capacity ?? 0) > 0 ? Math.round((activeTenants / Number(capacity._sum.capacity)) * 100) : 0,
        revenue: Number(revenue._sum.amount_paid ?? 0),
        dues: Number(dues._sum.amount ?? 0),
        subscription: hostel.hostel_subscriptions,
        /** The live Discovery listing, if any, and what the owner has open. */
        listing_review: {
          has_live_listing: Boolean(liveRevision),
          live_version: liveRevision?.version ?? null,
          live_since: liveRevision?.reviewed_at ?? null,
          open_status: openRevision?.status ?? null,
        },
      },
    });
  } catch (error: any) {
    const msg = String(error?.message || "Failed to fetch hostel");
    if (msg.startsWith("FORBIDDEN")) return apiError(msg.split(": ")[1] ?? msg, "FORBIDDEN", 403);
    return apiError(msg);
  }
}

/**
 * PATCH — correct a hostel's postal address.
 *
 * Admin-only, and narrow on purpose: exactly the five fields that make up where
 * the building is. It exists because the address is owner-typed and reaches
 * every listing card and the listing page, and Stayo's team fields the "the
 * address is wrong" mails — but had no way to fix one without asking the owner
 * to do it. Deliberately not a general hostel editor: name, phone, pricing and
 * listing state all have their own governed paths.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  if (!session || session.role !== "ADMIN") return apiError("Forbidden", "FORBIDDEN", 403);
  const { id } = await params;

  try {
    const existing = await prisma.hostels.findUnique({ where: { id }, select: { id: true } });
    if (!existing) return apiError("Hostel not found", "NOT_FOUND", 404);

    const body = await req.json().catch(() => ({}));

    // `address` is the one field the listing cannot render without, so it may be
    // corrected but not emptied. The rest are genuinely optional on the model and
    // an empty string is stored as NULL rather than as "".
    const text = (value: unknown, max: number): string | null | undefined => {
      if (value === undefined) return undefined;
      const trimmed = String(value ?? "").trim();
      if (trimmed.length > max) return undefined;
      return trimmed.length > 0 ? trimmed : null;
    };

    const address = text(body?.address, 300);
    if (body?.address !== undefined && !address) {
      return apiError("A hostel needs an address", "VALIDATION_ERROR", 422);
    }

    const pincode = text(body?.pincode, 10);
    if (pincode && !/^\d{6}$/.test(pincode)) {
      return apiError("Pincode must be 6 digits", "VALIDATION_ERROR", 422);
    }

    const data: Record<string, unknown> = { updated_at: new Date() };
    if (address !== undefined) data.address = address;
    const city = text(body?.city, 120);
    if (city !== undefined) data.city = city;
    const state = text(body?.state, 120);
    if (state !== undefined) data.state = state;
    if (pincode !== undefined) data.pincode = pincode;

    const updated = await prisma.hostels.update({
      where: { id },
      data,
      select: { id: true, address: true, city: true, state: true, pincode: true },
    });
    return apiResponse(updated);
  } catch (error: any) {
    return apiError(error?.message || "Failed to update the address");
  }
}
