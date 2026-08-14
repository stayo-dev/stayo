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

    const [utilityStatus, hostel] = await Promise.all([
      prisma.hostel_utility_status.findMany({ where: { hostel_id: tenant.hostel_id! } }),
      prisma.hostels.findUnique({ where: { id: tenant.hostel_id! }, select: { house_rules: true } }),
    ]);

    const allocation = (tenant as any).room_allocations[0];
    if (!allocation) {
      return apiResponse({ room: null, roommates: [], utilityStatus, houseRules: hostel?.house_rules ?? [] });
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
            profiles: {
              select: {
                name: true
              }
            }
          }
        }
      }
    });

    const roommates = occupants.map((occ: any) => ({
      name: occ.tenant?.profiles?.name || "Unknown"
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
      utilityStatus,
      houseRules: hostel?.house_rules ?? [],
    });
  } catch (error: any) {
    return apiError(error?.message || "Failed to fetch room data");
  }
}
