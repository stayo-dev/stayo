export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { liveTenancyWhere } from "@/lib/tenancy/active-tenancy";


/**
 * 👨‍🎓 TENANT ME ROOM
 * GET /api/tenants/me/room
 */
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session || session.role !== "TENANT") {
    return apiError("Forbidden: Only tenants can access this endpoint", "FORBIDDEN", 403);
  }

  try {
    const tenant = await prisma.tenants.findFirst({
      where: liveTenancyWhere(session.sub),
      select: {
        id: true,
        hostel_id: true,
        room_allocations: {
          where: { is_active: true, end_date: null },
          include: { room: true }
        }
      }
    });

    if (!tenant) {
      return apiError("Tenant record not found", "NOT_FOUND", 404);
    }

    const [hostel, approvedRevision] = await Promise.all([
      // `public_slug` so the tenant can share their own hostel — inviting a
      // friend into the empty bed beside them is the one referral that needs
      // no incentive scheme.
      prisma.hostels.findUnique({ where: { id: tenant.hostel_id! }, select: { house_rules: true, name: true, public_slug: true } }),
      /*
       * The same APPROVED revision Discovery reads. One source for both, so a
       * tenant and a prospective tenant can never be shown different facts
       * about the same hostel — and an owner still cannot publish either
       * without review (ADR-040).
       */
      prisma.hostel_marketing_revisions.findFirst({
        where: { hostel_id: tenant.hostel_id!, status: "APPROVED" },
        orderBy: { created_at: "desc" },
        select: { content: true },
      }),
    ]);

    const allocation = (tenant as any).room_allocations[0];
    if (!allocation) {
      return apiResponse({ room: null, roommates: [], facilities: [], hostel: { name: hostel?.name ?? null, public_slug: hostel?.public_slug ?? null }, houseRules: hostel?.house_rules ?? [] });
    }

    const room = allocation.room;

    // Fetch roommates
    const occupants = await prisma.roomAllocation.findMany({
      where: {
        room_id: room.id,
        is_active: true,
        end_date: null,
        tenant_id: { not: tenant.id }
      },
      include: {
        tenant: {
          select: {
            phone_1: true,
            profiles: {
              select: {
                name: true,
                phone: true
              }
            }
          }
        }
      }
    });

    // Name and phone only. Enough to knock on a door or call, and nothing a
    // roommate would resent being handed to the person in the next bed.
    const roommates = occupants.map((occ: any) => ({
      name: occ.tenant?.profiles?.name || "Unknown",
      phone: occ.tenant?.profiles?.phone ?? occ.tenant?.phone_1 ?? null,
    }));

    return apiResponse({
      room: {
        room_no: room.room_no,
        capacity: room.capacity,
        floor: room.floor,
        floor_id: room.floor,
        wifi_name: room.wifi_name ?? null,
        wifi_password: room.wifi_password ?? null,
        notes: room.notes ?? null,
      },
      roommates,
      // Only enabled amenities, matching what Discovery publishes.
      facilities: ((approvedRevision?.content as any)?.amenities ?? []).filter((a: any) => a?.enabled),
      hostel: { name: hostel?.name ?? null, public_slug: hostel?.public_slug ?? null },
      houseRules: hostel?.house_rules ?? [],
    });
  } catch (error: any) {
    return apiError(error?.message || "Failed to fetch room data");
  }
}
