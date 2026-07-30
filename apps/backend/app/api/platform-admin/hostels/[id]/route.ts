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
        tenants: activeTenants,
        rooms: hostel._count.rooms,
        capacity: Number(capacity._sum.capacity ?? 0),
        occupancy: Number(capacity._sum.capacity ?? 0) > 0 ? Math.round((activeTenants / Number(capacity._sum.capacity)) * 100) : 0,
        revenue: Number(revenue._sum.amount_paid ?? 0),
        dues: Number(dues._sum.amount ?? 0),
        subscription: hostel.hostel_subscriptions,
      },
    });
  } catch (error: any) {
    const msg = String(error?.message || "Failed to fetch hostel");
    if (msg.startsWith("FORBIDDEN")) return apiError(msg.split(": ")[1] ?? msg, "FORBIDDEN", 403);
    return apiError(msg);
  }
}
