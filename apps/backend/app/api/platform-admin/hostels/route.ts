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
 * GET /api/platform-admin/hostels?search=&verification=&listing=
 * Platform-wide hostel roster across all owners, with real tenant/occupancy/
 * revenue stats composed from existing tables — not a separate cache.
 */
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  try {
    requireAdmin(session);

    const { searchParams } = new URL(req.url);
    const search = searchParams.get("search")?.trim();
    const verification = searchParams.get("verification") || undefined;
    const listing = searchParams.get("listing") || undefined;

    const hostels = await prisma.hostels.findMany({
      where: {
        ...(search
          ? {
              // An admin searching "Shiva" or a phone number is looking for
              // that person's hostels, not for a hostel called Shiva — so the
              // owner relation is searched too. Address is included because
              // locality names ("Koramangala") live there, not in `city`.
              OR: [
                { name: { contains: search, mode: "insensitive" } },
                { city: { contains: search, mode: "insensitive" } },
                { address: { contains: search, mode: "insensitive" } },
                { phone: { contains: search } },
                { profiles: { name: { contains: search, mode: "insensitive" } } },
                { profiles: { phone: { contains: search } } },
                { profiles: { email: { contains: search, mode: "insensitive" } } },
              ],
            }
          : {}),
        ...(verification ? { verification_status: verification as any } : {}),
        ...(listing ? { listing_status: listing as any } : {}),
      },
      select: {
        id: true,
        name: true,
        city: true,
        phone: true,
        address: true,
        verification_status: true,
        listing_status: true,
        created_at: true,
        owner_id: true,
        profiles: { select: { name: true } },
        _count: { select: { tenants: true, rooms: true } },
        hostel_subscriptions: { select: { status: true } },
      },
      orderBy: { created_at: "desc" },
      take: 200,
    });

    // How many hostels each owner runs, platform-wide — not scoped to the
    // current search/filter, so the count stays correct even when a filter
    // narrows which of an owner's hostels are visible in this result page.
    const ownerIds = Array.from(new Set(hostels.map((h: any) => h.owner_id)));
    const hostelCountsByOwner = await prisma.hostels.groupBy({
      by: ["owner_id"],
      where: { owner_id: { in: ownerIds } },
      _count: { _all: true },
    });
    const hostelCountByOwner = new Map(hostelCountsByOwner.map((r: any) => [r.owner_id, r._count._all]));

    // Occupied-bed + revenue figures composed from real tables, one query
    // per figure (small N of hostels expected for a platform console) —
    // matches the "compose, don't reimplement" convention.
    const hostelIds = hostels.map((h: any) => h.id);
    const [activeTenantCounts, revenueSums, duesSums, capacitySums] = await Promise.all([
      prisma.tenants.groupBy({ by: ["hostel_id"], where: { hostel_id: { in: hostelIds }, status: "ACTIVE" }, _count: { _all: true } }),
      prisma.payments.groupBy({
        by: ["hostel_id"],
        where: { hostel_id: { in: hostelIds }, payment_date: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) } },
        _sum: { amount_paid: true },
      }),
      prisma.rent_obligations.groupBy({
        by: ["hostel_id"],
        where: { hostel_id: { in: hostelIds }, status: { in: ["PENDING", "PARTIAL", "OVERDUE"] } },
        _sum: { amount: true },
      }),
      prisma.rooms.groupBy({ by: ["hostel_id"], where: { hostel_id: { in: hostelIds } }, _sum: { capacity: true } }),
    ]);
    const activeByHostel = new Map(activeTenantCounts.map((r: any) => [r.hostel_id, r._count._all]));
    const revenueByHostel = new Map(revenueSums.map((r: any) => [r.hostel_id, Number(r._sum.amount_paid ?? 0)]));
    const duesByHostel = new Map(duesSums.map((r: any) => [r.hostel_id, Number(r._sum.amount ?? 0)]));
    const capacityByHostel = new Map(capacitySums.map((r: any) => [r.hostel_id, Number(r._sum.capacity ?? 0)]));

    const result = hostels.map((h: any) => {
      const capacity = Number(capacityByHostel.get(h.id) ?? 0);
      const active = Number(activeByHostel.get(h.id) ?? 0);
      return {
        id: h.id,
        name: h.name,
        city: h.city,
        owner: h.profiles?.name ?? "—",
        owner_id: h.owner_id,
        owner_hostel_count: Number(hostelCountByOwner.get(h.owner_id) ?? 1),
        verification_status: h.verification_status,
        listing_status: h.listing_status,
        subscription_status: h.hostel_subscriptions?.status ?? null,
        tenants: active,
        rooms: h._count.rooms,
        capacity,
        occupancy: capacity > 0 ? Math.round((active / capacity) * 100) : 0,
        revenue: revenueByHostel.get(h.id) ?? 0,
        dues: duesByHostel.get(h.id) ?? 0,
        created_at: h.created_at,
      };
    });

    return apiResponse({ hostels: result });
  } catch (error: any) {
    const msg = String(error?.message || "Failed to fetch hostels");
    if (msg.startsWith("FORBIDDEN")) return apiError(msg.split(": ")[1] ?? msg, "FORBIDDEN", 403);
    return apiError(msg);
  }
}
