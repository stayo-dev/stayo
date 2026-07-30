export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { prisma } from "@/lib/db";

/**
 * 🏨 GET /api/owner/hostels
 *
 * Returns all hostels belonging to the authenticated owner.
 * Used by the frontend hostel switcher to select operational context.
 *
 * Response includes summary stats (room count, tenant count) for each hostel.
 * Access: Owner/Admin only
 */
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  try {
    const url = new URL(req.url);
    const includeArchived = url.searchParams.get("include_archived") === "true";

    const hostels = await prisma.hostels.findMany({
      where: { 
        owner_id: session.sub, 
        ...(includeArchived ? {} : { status: { in: ["ACTIVE", "INACTIVE"] } })
      },
      orderBy: { created_at: "asc" },
      select: {
        id: true,
        name: true,
        phone: true,
        address: true,
        city: true,
        state: true,
        pincode: true,
        upi_id: true,
        public_slug: true,
        admissions_enabled: true,
        is_active: true,
        status: true,
        created_at: true,
        rooms: {
          where: { is_active: true },
          select: {
            id: true,
            capacity: true,
            room_allocations: {
              where: { is_active: true, end_date: null },
              select: { id: true },
            },
            tenant_invitation_reservations: {
              where: { status: "ACTIVE", expires_at: { gt: new Date() } },
              select: { id: true },
            },
          },
        },
      },
    });

    const result = await Promise.all(
      hostels.map(async (hostel: any) => {
        let slug = hostel.public_slug;
        if (!slug) {
          slug = `${hostel.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 60)}-${String(hostel.id).slice(0, 8)}`;
          await prisma.hostels.update({
            where: { id: hostel.id },
            data: { public_slug: slug },
          });
        }

        const totalRooms = hostel.rooms.length;
        const totalCapacity = hostel.rooms.reduce((s: number, r: any) => s + r.capacity, 0);
        const occupiedBeds = hostel.rooms.reduce((s: number, r: any) => s + r.room_allocations.length, 0);
        const reservedBeds = hostel.rooms.reduce((s: number, r: any) => s + r.tenant_invitation_reservations.length, 0);
        const usedBeds = occupiedBeds + reservedBeds;
        const vacantBeds = Math.max(totalCapacity - usedBeds, 0);
        const occupancyRate = totalCapacity > 0 ? Math.round((usedBeds / totalCapacity) * 100) : 0;

        return {
          id: hostel.id,
          name: hostel.name,
          phone: hostel.phone,
          address: hostel.address,
          city: hostel.city,
          state: hostel.state,
          pincode: hostel.pincode,
          upi_id: hostel.upi_id,
          public_slug: slug,
          admissions_enabled: hostel.admissions_enabled,
          is_active: hostel.is_active,
          status: hostel.status,
          created_at: hostel.created_at,
          stats: {
            total_rooms: totalRooms,
            total_capacity: totalCapacity,
            occupied_beds: occupiedBeds,
            reserved_beds: reservedBeds,
            used_beds: usedBeds,
            vacant_beds: vacantBeds,
            occupancy_rate: occupancyRate,
          },
        };
      })
    );

    return apiResponse({
      hostels: result,
      total_hostels: result.length,
      is_multi_hostel: result.length > 1,
    });
  } catch (error: any) {
    return apiError(error.message || "Failed to fetch hostels");
  }
}

export async function POST(req: NextRequest) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  try {
    const body = await req.json();
    const { propertyService } = await import("@/lib/services/property-service");
    
    const name = (body.name || body.hostel_name || "New Hostel").trim();
    const phone = body.phone || body.hostel_phone || "";

    // Owner-scoped duplicate hostel check
    const existing = await prisma.hostels.findFirst({
      where: {
        owner_id: session.sub,
        status: { in: ["ACTIVE", "INACTIVE"] },
        name: {
          equals: name,
          mode: "insensitive",
        },
      },
    });
    if (existing) {
      return apiError("A hostel with this name already exists", "VALIDATION_ERROR", 400);
    }
    
    const hostel = await prisma.hostels.create({
      data: {
        owner_id: session.sub,
        name,
        phone,
        address: body.address || "",
        city: body.city || null,
        state: body.state || null,
        pincode: body.pincode || null,
        status: "ACTIVE",
        is_active: true,
      },
    });

    // Owner-acquisition funnel phase 2: if this owner was born from a lead
    // activation link, advance the lead to HOSTEL_CREATED. Non-fatal by
    // design (wrapped inside the service itself) — never blocks real
    // hostel creation.
    const { leadInvitationService } = await import("@/src/services/platform-leads/lead-invitation-service");
    await leadInvitationService.markHostelCreated(session.sub);

    const result = await propertyService.getOwnerProfile(session.sub);
    return apiResponse({
      ...result,
      hostel,
      id: hostel.id,
    });
  } catch (error: any) {
    const msg = typeof error === "string" ? error : (error && typeof error.message === "string" ? error.message : String(error));
    if (msg.startsWith("PLAN_LIMIT:")) {
      const code = msg.replace("PLAN_LIMIT:", "").trim();
      return apiError(code, code, 402);
    }
    return apiError(msg || "Failed to create hostel");
  }
}
