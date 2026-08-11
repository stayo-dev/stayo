import { z } from "zod";
import { normalizeIndianPhone } from "../../../lib/utils/phone-utils";

const MAX_AMOUNT_INR = 1_000_000;

function optionalNumber() {
  return z
    .union([z.number(), z.string()])
    .optional()
    .nullable()
    .transform((val) => {
      if (val === undefined || val === null || val === "") return undefined;
      const num = Number(val);
      return Number.isNaN(num) ? undefined : num;
    });
}

function optionalPositiveInteger(max = 120) {
  return z
    .union([z.number(), z.string()])
    .optional()
    .nullable()
    .transform((val) => {
      if (val === undefined || val === null || val === "") return undefined;
      const num = Number(val);
      return Number.isNaN(num) || num <= 0 || num > max ? undefined : Math.floor(num);
    });
}
export const InvitationSchema = z.object({
  email: z.string().trim().email().optional().or(z.literal("")).nullable(),
  name: z.string().min(2, "Name must be at least 2 characters"),
  phone: z.string().refine((val) => normalizeIndianPhone(val) !== null, {
    message: "Invalid phone number. Must be a valid 10-digit Indian mobile number.",
  }),
  room_id: z.string().uuid(),
  monthly_rent: optionalNumber(),
  advance_amount: optionalNumber(),
  maintenance_amount: optionalNumber(),
  joining_date: z.string().optional(),            // ISO date string, defaults to today
  maintenance_type: z.enum(["MONTHLY", "ONE_TIME", "NONE"]).optional(), // defaults to hostel billing policy
  agreement_duration_months: optionalPositiveInteger(120),
  agreement_start_date: z.string().max(30).optional(),
  payment_frequency: z.enum(["MONTHLY", "QUARTERLY", "HALF_YEARLY", "ACADEMIC_YEARLY", "CUSTOM_INSTALLMENTS"]).optional(),
});

export const InvitationUpdateSchema = z.object({
  email: z.string().trim().email().optional().or(z.literal("")).nullable(),
  name: z.string().min(2, "Name must be at least 2 characters"),
  phone: z.string().refine((val) => normalizeIndianPhone(val) !== null, {
    message: "Invalid phone number. Must be a valid 10-digit Indian mobile number.",
  }),
  room_id: z.string().uuid(),
  monthly_rent: optionalNumber(),
  advance_amount: optionalNumber(),
  maintenance_amount: optionalNumber(),
  joining_date: z.string().optional(),
  maintenance_type: z.enum(["MONTHLY", "ONE_TIME", "NONE"]).optional(),
  agreement_duration_months: optionalPositiveInteger(120),
  agreement_start_date: z.string().max(30).optional(),
  payment_frequency: z.enum(["MONTHLY", "QUARTERLY", "HALF_YEARLY", "ACADEMIC_YEARLY", "CUSTOM_INSTALLMENTS"]).optional(),
});

export const ActivationSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8),
  confirm_password: z.string().min(8),
});

