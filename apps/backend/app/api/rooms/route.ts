export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import crypto from "crypto";
import { getSession } from "@/lib/auth";
import { RoomCreateSchema } from "@/lib/validators";
import { ApiResponse } from "@/src/lib/api-response";
import { ApiError } from "@/src/lib/api-error";
import { roomRepository } from "@/src/repositories/roomRepository";
import { prisma } from "@/lib/db";
import { propertyService } from "@/lib/services/property-service";
import { roomCapacityService } from "@/lib/services/room-capacity-service";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";
import { assertHostelBelongsToOwner, requireHostelBelongsToOwner } from "@/lib/security/scoped-query";
import { eventSystem } from "@/lib/events";


/**
 * 🏠 ROOMS — List & Create
 * GET  /api/rooms/ — List rooms (grouped by floor or flat)
 * POST /api/rooms/ — Create a new room
 */
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    console.warn(`[rooms.GET] Forbidden access attempt by ${session?.role} ${session?.sub}`);
    return ApiResponse.error(ApiError.forbidden("Forbidden"));
  }

  try {
    const scope = resolveOwnerScope(session);
    const { searchParams } = new URL(req.url);
    const grouped = searchParams.get("grouped") === "true";
    const hostelId = searchParams.get("hostelId") || undefined;
    
    console.log(`[rooms.GET] Fetching rooms for owner ${scope.owner_id}, hostel ${hostelId}, grouped=${grouped}`);
    
    if (!hostelId) {
      console.warn("[rooms.GET] Missing hostelId context");
      return ApiResponse.error(ApiError.badRequest("hostelId is required"));
    }

    if (grouped) {
      await requireHostelBelongsToOwner(scope.owner_id, hostelId);
      const floors = await propertyService.getFloorsWithRooms(scope.owner_id, hostelId);
      return ApiResponse.success(floors);
    }

    const [roomResult] = await prisma.$queryRaw<any[]>`
      WITH hostel_scope AS (
        SELECT EXISTS (
          SELECT 1
          FROM hostels h
          WHERE h.id = ${hostelId}::uuid
            AND h.owner_id = ${scope.owner_id}::uuid
        ) AS allowed
      ),
      room_rows AS (
        SELECT
          r.id,
          r.room_no,
          r.capacity,
          r.floor,
          r.floor_id,
          f.name AS floor_name,
          COALESCE(f.sort_order, 999) AS floor_sort_order,
          r.base_rent,
          r.wifi_name,
          r.notes,
          -- What the room is like to live in (migration 073).
          r.length_ft,
          r.width_ft,
          r.cupboard_per_bed,
          r.under_bed_storage,
          r.study_desk,
          r.windows,
          r.hostel_id,
          r.is_active,
          COALESCE(alloc.tenants, '[]'::jsonb) AS tenants
        FROM rooms r
        JOIN hostel_scope hs ON hs.allowed
        LEFT JOIN floors f ON f.id = r.floor_id
        LEFT JOIN LATERAL (
          SELECT jsonb_agg(jsonb_build_object(
            'allocation_id', ra.id,
            'tenant_id', t.id,
            'name', p.name,
            'phone', p.phone,
            'monthly_rent', COALESCE(t.monthly_rent, r.base_rent, 0),
            'joined_date', ra.start_date
          ) ORDER BY ra.start_date ASC) AS tenants
          FROM room_allocations ra
          LEFT JOIN tenants t ON t.id = ra.tenant_id
          LEFT JOIN profiles p ON p.id = t.profile_id
          WHERE ra.room_id = r.id
            AND ra.is_active = true
            AND ra.end_date IS NULL
        ) alloc ON true
        WHERE r.hostel_id = ${hostelId}::uuid
          AND r.is_active = true
        ORDER BY r.room_no ASC
      )
      SELECT
        hs.allowed,
        COALESCE(jsonb_agg(to_jsonb(room_rows) ORDER BY room_rows.room_no ASC) FILTER (WHERE room_rows.id IS NOT NULL), '[]'::jsonb) AS rooms
      FROM hostel_scope hs
      LEFT JOIN room_rows ON true
      GROUP BY hs.allowed
    `;

    if (!roomResult?.allowed) {
      return ApiResponse.error(ApiError.forbidden("Hostel is not owned by the authenticated owner"));
    }

    const rawRooms = Array.isArray(roomResult.rooms) ? roomResult.rooms : [];
    const capacityMap = await roomCapacityService.getHostelCapacityMap(hostelId, { ownerId: scope.owner_id });
    const rooms = rawRooms.map((room: any) => {
      const allocs = Array.isArray(room.tenants) ? room.tenants : [];
      const capacity = capacityMap.get(room.id);
      const occupiedCount = capacity?.occupied ?? allocs.length;
      const reservedCount = capacity?.reserved ?? 0;
      const firstTenant = allocs[0] ?? null;
      const tenants = allocs.map((allocation: any) => ({
        allocation_id: allocation.allocation_id,
        tenant_id: allocation.tenant_id ?? null,
        name: allocation.name ?? null,
        phone: allocation.phone ?? null,
        monthly_rent: Number(allocation.monthly_rent ?? room.base_rent ?? 0),
        joined_date: allocation.joined_date,
      }));
      const derivedStatus = capacity?.state ?? (occupiedCount === 0 ? "vacant" : "occupied");
      return {
        id: room.id,
        room_no: room.room_no,
        room_number: room.room_no,
        capacity: room.capacity,
        floor: room.floor,
        floor_id: room.floor_id ?? null,
        floor_name: room.floor_name ?? null,
        floor_sort_order: room.floor_sort_order ?? 999,
        base_rent: room.base_rent,
        monthly_rent: room.base_rent,
        rent: room.base_rent,
        wifi_name: room.wifi_name ?? null,
        notes: room.notes ?? null,
        /** Grouped, because the owner edits and the listing reads them together. */
        space: {
          length_ft: room.length_ft == null ? null : Number(room.length_ft),
          width_ft: room.width_ft == null ? null : Number(room.width_ft),
          cupboard_per_bed: room.cupboard_per_bed ?? null,
          under_bed_storage: room.under_bed_storage ?? null,
          study_desk: room.study_desk ?? null,
          windows: room.windows ?? null,
        },
        hostel_id: room.hostel_id,
        is_active: room.is_active,
        status: derivedStatus,
        occupied_count: occupiedCount,
        reserved_count: reservedCount,
        used_count: capacity?.used ?? occupiedCount,
        vacant_count: capacity?.available ?? Math.max(0, room.capacity - occupiedCount),
        tenants,
        tenant_name: firstTenant?.name ?? null,
        tenant_id: firstTenant?.tenant_id ?? null,
        tenant_phone: firstTenant?.phone ?? null,
        tenant_rent: firstTenant ? Number(firstTenant.monthly_rent ?? room.base_rent) : null,
      };
    });

    return ApiResponse.success(rooms);
  } catch (error: any) {
    console.error("Detailed API Error [rooms.GET]:", error);
    return ApiResponse.error(error);
  }
}

export async function POST(req: NextRequest) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    console.warn(`[rooms.POST] Forbidden access attempt by ${session?.role} ${session?.sub}`);
    return ApiResponse.error(ApiError.forbidden("Forbidden"));
  }

  try {
    const scope = resolveOwnerScope(session);
    const body = await req.json().catch(() => ({}));
    console.log(`[rooms.POST] Creating room for owner ${scope.owner_id}`, body);
    
    const validated = RoomCreateSchema.safeParse(body);
    if (!validated.success) {
      console.warn(`[rooms.POST] Validation failed for owner ${scope.owner_id}`);
      return ApiResponse.error(ApiError.validationError("Validation error", { issues: validated.error.errors }));
    }

    let hostelId = body.hostelId;
    let hostel;
    if (hostelId) {
      hostel = await assertHostelBelongsToOwner(scope.owner_id, hostelId);
    } else {
      await requireHostelBelongsToOwner(scope.owner_id, hostelId);
    }
    
    if (!hostel) {
      console.warn(`[rooms.POST] Hostel context missing for owner ${scope.owner_id}`);
      return ApiResponse.error(ApiError.notFound("No hostel found. Please complete hostel setup first."));
    }

    if (hostel.status === "ARCHIVED") {
      return ApiResponse.error(ApiError.forbidden("Cannot perform operational actions on an archived hostel"));
    }
    if (hostel.status === "INACTIVE") {
      return ApiResponse.error(ApiError.forbidden("Cannot perform operational actions on an inactive hostel"));
    }

    // Check for duplicate room number
    const existing = await roomRepository.findFirst({
      where: { hostel_id: hostel.id, room_no: validated.data.room_no, is_active: true },
    });
    
    if (existing) {
      console.warn(`[rooms.POST] Room ${validated.data.room_no} already exists in hostel ${hostel.id}`);
      return ApiResponse.error(ApiError.conflict(`Room ${validated.data.room_no} already exists`));
    }

    const room = await roomRepository.create({
      data: {
        id: crypto.randomUUID(),
        hostel_id: hostel.id,
        room_no: validated.data.room_no,
        capacity: validated.data.capacity,
        floor: validated.data.floor,
        floor_id: validated.data.floor_id,
        room_type: validated.data.room_type,
        base_rent: validated.data.base_rent,
        wifi_name: validated.data.wifi_name,
        wifi_password: validated.data.wifi_password,
        notes: validated.data.notes,
      },
    });

    console.log(`[rooms.POST] Room created: ${room.id}`);
    await eventSystem.trigger("room_created", {
      room_id: room.id,
      room_no: room.room_no,
      hostel_id: hostel.id,
      owner_id: scope.owner_id,
      user_id: scope.actor_id,
      capacity: room.capacity,
    }).catch((e: any) => console.error("Failed to trigger room_created event:", e));

    return ApiResponse.success(room, "Room created successfully", { status: 201 });
  } catch (error: any) {
    console.error("Detailed API Error [rooms.POST]:", error);
    return ApiResponse.error(error);
  }
}
