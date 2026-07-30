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

export const AllocationSchema = z.object({
  tenant_id: z.string().uuid(),
  room_id: z.string().uuid(),
  start_date: z.string().transform((val) => new Date(val)),
});
