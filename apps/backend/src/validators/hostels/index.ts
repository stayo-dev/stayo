import { z } from "zod";

/** The four property types the onboarding wizard offers. */
export const HOSTEL_TYPES = ["BOYS", "GIRLS", "CO_LIVING", "WORKING_PROS"] as const;
export type HostelType = (typeof HOSTEL_TYPES)[number];

/**
 * Everything POST /api/owner/hostels/provision needs to build a hostel in one
 * transaction: identity, the billing figures onboarding used to discard, and
 * the floor/room/bed structure.
 *
 * Upper bounds mirror the wizard's own steppers (floors ≤ 8, rooms/floor ≤ 20,
 * beds/room ≤ 8) so a malformed request can't ask for a 10,000-room property
 * and hold a transaction open.
 */
export const HostelProvisionSchema = z.object({
  name: z.string().trim().min(2).max(120),
  type: z.enum(HOSTEL_TYPES).optional(),
  address: z.string().trim().max(500).default(""),
  city: z.string().trim().max(120).optional(),
  state: z.string().trim().max(120).optional(),
  pincode: z.string().trim().max(20).optional(),
  phone: z.string().trim().max(20).optional(),

  food_included: z.coerce.boolean().default(false),
  security_deposit: z.coerce.number().nonnegative().default(0),

  floors: z.coerce.number().int().min(1).max(8),
  rooms_per_floor: z.coerce.number().int().min(1).max(20),
  beds_per_room: z.coerce.number().int().min(1).max(8),

  // Required, not optional: a provisioned room with no rent shows ₹0 on the
  // room grid and prefills nothing in the invite wizard. The owner enters this
  // on the wizard's Details step alongside the security deposit.
  //
  // Not `z.coerce.number()` — that turns null into 0, which would let a
  // missing rent through disguised as a free room. Null/undefined/"" are
  // rejected; a numeric string (what an <input> gives us) is still accepted.
  base_rent: z.preprocess(
    (value) => (value === null || value === undefined || value === "" ? undefined : Number(value)),
    z
      .number({
        required_error: "base_rent is required",
        invalid_type_error: "base_rent must be a number",
      })
      .nonnegative(),
  ),

  publish: z.enum(["now", "draft"]).default("now"),
});

export type HostelProvisionInput = z.input<typeof HostelProvisionSchema>;
export type HostelProvisionData = z.output<typeof HostelProvisionSchema>;
