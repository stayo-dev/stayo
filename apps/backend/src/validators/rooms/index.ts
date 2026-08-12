import { z } from "zod";

export const RoomCreateSchema = z.object({
  room_no:      z.string().min(1),
  capacity:     z.coerce.number().int().positive(),
  floor:        z.coerce.number().int().optional(),
  floor_id:     z.string().uuid().optional(),
  room_type:    z.string().optional(),
  base_rent:    z.coerce.number().nonnegative().optional(),
  wifi_name:    z.string().nullable().optional(),
  wifi_password: z.string().nullable().optional(),
  notes:        z.string().nullable().optional(),
});

/**
 * A floor's worth of rooms, created in one request.
 *
 * The hostel builder fills a floor at a time, and a floor is commonly 4–12
 * rooms with individually chosen sharing and rent — so this deliberately
 * takes a list of fully-specified rooms rather than a count plus one shared
 * capacity/rent. The uniform-grid shape (`rooms_per_floor` × `beds_per_room`
 * × one `base_rent`, in `HostelProvisionSchema`) cannot express a floor that
 * mixes 4-sharing and 2-sharing rooms, which is the normal case.
 *
 * The ceiling mirrors the room-per-floor bound the provisioning schema
 * already enforces, so one request can't hold a transaction open building a
 * thousand rooms.
 */
export const RoomBulkCreateSchema = z.object({
  rooms: z
    .array(
      z.object({
        room_no: z.string().trim().min(1).max(40),
        capacity: z.coerce.number().int().positive().max(20),
        base_rent: z.coerce.number().nonnegative().optional(),
        room_type: z.string().trim().max(60).optional(),
      }),
    )
    .min(1, "At least one room is required")
    .max(40, "A floor can be given at most 40 rooms at once"),
});

export const AllocationSchema = z.object({
  tenant_id: z.string().uuid(),
  room_id: z.string().uuid(),
  start_date: z.string().transform((val) => new Date(val)),
});
