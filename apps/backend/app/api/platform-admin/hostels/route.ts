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
              OR: [
                { name: { contains: search, mode: "insensitive" } },
                { city: { contains: search, mode: "insensitive" } },
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
