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
 * GET /api/platform-admin/owners/[id]
 *
 * One owner and everything the admin needs to act on them — including their
 * hostels, with the same per-hostel figures the standalone hostels roster
 * computes.
 *
 * Hostels are returned *here*, as a child of the owner, rather than being
 * looked up on a separate platform-wide list. The admin's job is managing
 * businesses; a property only means something in the context of whose it is.
 * Serving them from the owner also removes the need for an owner filter on a
 * global hostel list, which is the kind of cross-screen link that silently
 * stops filtering the moment someone forgets to read the query param.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession(req);
  try {
    requireAdmin(session);

    const owner = await prisma.profile.findFirst({
      where: { id: params.id, role: "OWNER" },
      select: { id: true, name: true, email: true, phone: true, created_at: true, is_active: true, city: true },
    });
    if (!owner) throw new Error("NOT_FOUND: Owner not found");

    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

    const hostels = await prisma.hostels.findMany({
      where: { owner_id: owner.id },
      select: {
        id: true,
        name: true,
        city: true,
        verification_status: true,
        verification_note: true,
        listing_status: true,
        created_at: true,
        _count: { select: { rooms: true } },
      },
      orderBy: { created_at: "desc" },
    });
    const hostelIds = hostels.map((h: { id: string }) => h.id);

    const [activeTenants, capacity, collected, dues, documents, subscriptions, activity] = await Promise.all([
      prisma.tenants.groupBy({
        by: ["hostel_id"],
        where: { hostel_id: { in: hostelIds }, status: "ACTIVE" },
        _count: { _all: true },
      }),
      prisma.rooms.groupBy({
        by: ["hostel_id"],
        where: { hostel_id: { in: hostelIds }, is_active: true },
        _sum: { capacity: true },
      }),
      prisma.payments.groupBy({
        by: ["hostel_id"],
        where: { hostel_id: { in: hostelIds }, payment_date: { gte: monthStart } },
        _sum: { amount_paid: true },
      }),
      prisma.rent_obligations.groupBy({
        by: ["hostel_id"],
        where: { hostel_id: { in: hostelIds }, status: { in: ["PENDING", "PARTIAL", "OVERDUE"] } },
        _sum: { amount: true },
      }),
      prisma.owner_documents.findMany({
        where: { profile_id: owner.id, is_active: true },
        select: { id: true, doc_type: true, status: true, review_note: true, uploaded_at: true, file_url: true },
        orderBy: { uploaded_at: "desc" },
      }),
      prisma.hostel_subscriptions.findMany({
        where: { hostel_id: { in: hostelIds } },
        select: { hostel_id: true, status: true, amount: true, billing_cycle: true, next_renewal_at: true },
      }),
      // Last recorded actions. Sparse by nature — only a few services write
      // here — so it is labelled as activity, never as "last seen".
      prisma.activity_logs.findMany({
        where: { owner_id: owner.id },
        select: { id: true, action_type: true, entity_type: true, timestamp: true },
        orderBy: { timestamp: "desc" },
        take: 12,
      }),
    ]);

    const num = (rows: any[], key: string, pick: (r: any) => number) =>
      new Map<string, number>(rows.map((r) => [r[key] as string, pick(r)]));

    const activeByHostel = num(activeTenants, "hostel_id", (r) => r._count._all);
    const capacityByHostel = num(capacity, "hostel_id", (r) => Number(r._sum.capacity ?? 0));
    const collectedByHostel = num(collected, "hostel_id", (r) => Number(r._sum.amount_paid ?? 0));
    const duesByHostel = num(dues, "hostel_id", (r) => Number(r._sum.amount ?? 0));
    // `as const` on the tuple — without it TS widens the pair to an array and
    // `.get()` resolves to `{}`, losing every field on the subscription.
    const subByHostel = new Map(subscriptions.map((s: any) => [s.hostel_id, s] as const));

    const hostelRows = hostels.map((h: any) => {
      const beds = capacityByHostel.get(h.id) ?? 0;
      const active = activeByHostel.get(h.id) ?? 0;
      const sub: any = subByHostel.get(h.id);
      return {
        id: h.id,
        name: h.name,
        city: h.city,
        verification_status: h.verification_status,
        verification_note: h.verification_note,
        listing_status: h.listing_status,
        rooms: h._count.rooms,
        capacity: beds,
        active_tenants: active,
        occupancy: beds > 0 ? Math.round((active / beds) * 100) : 0,
        collected_this_month: collectedByHostel.get(h.id) ?? 0,
        outstanding: duesByHostel.get(h.id) ?? 0,
        subscription_status: sub ? String(sub.status) : null,
        created_at: h.created_at,
      };
    });

    const sum = (map: Map<string, number>) =>
      hostelIds.reduce((acc: number, id: string) => acc + (map.get(id) ?? 0), 0);
    const totalCapacity = sum(capacityByHostel);
    const totalActive = sum(activeByHostel);
    const totalTenants = await prisma.tenants.count({ where: { owner_id: owner.id } });

    const mrr = subscriptions.reduce(
      (acc: number, s: any) =>
        String(s.status) === "ACTIVE"
          ? acc + (String(s.billing_cycle) === "YEARLY" ? Number(s.amount) / 12 : Number(s.amount))
          : acc,
      0,
    );

    const verifiedTypes = new Set(
      documents
        .filter((d: any) => String(d.status).toUpperCase() === "VERIFIED")
        .map((d: any) => String(d.doc_type).toUpperCase()),
    );

    return apiResponse({
      owner: {
        id: owner.id,
        name: owner.name,
        email: owner.email,
        phone: owner.phone,
        city: owner.city,
        joined_at: owner.created_at,
        is_active: owner.is_active,

        hostels: hostels.length,
        hostels_live: hostelRows.filter((h: any) => h.listing_status === "LIVE").length,
        hostels_awaiting_approval: hostelRows.filter((h: any) => h.verification_status === "PENDING").length,

        tenants: totalTenants,
        active_tenants: totalActive,
        capacity: totalCapacity,
        occupancy: totalCapacity > 0 ? Math.round((totalActive / totalCapacity) * 100) : 0,

        collected_this_month: sum(collectedByHostel),
        outstanding: sum(duesByHostel),

        documents_submitted: documents.length,
        documents_verified: ["AADHAAR", "PAN"].every((t) => verifiedTypes.has(t)),
        documents_rejected: documents.some((d: any) => String(d.status).toUpperCase() === "REJECTED"),

        mrr,
        subscription_statuses: subscriptions.map((s: any) => String(s.status)),
      },
      hostels: hostelRows,
      documents,
      activity,
    });
  } catch (error: any) {
    const msg = String(error?.message || "Failed to fetch owner");
    if (msg.startsWith("FORBIDDEN")) return apiError(msg.split(": ")[1] ?? msg, "FORBIDDEN", 403);
    if (msg.startsWith("NOT_FOUND")) return apiError(msg.split(": ")[1] ?? msg, "NOT_FOUND", 404);
    return apiError(msg);
  }
}
