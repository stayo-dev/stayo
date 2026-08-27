import { z } from "zod";
import { normalizeIndianPhone } from "../../../lib/utils/phone-utils";

const MAX_AMOUNT_INR = 1_000_000;
const SHORT_TEXT = 255;
const LONG_TEXT = 1000;
const URL_MAX = 2048;

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
  // Task 9b: "Just add to my records" creates the same invitation record but
  // opts out of the WhatsApp/email send — defaults to false/undefined, so the
  // ordinary "Send invite" path (which never sets this) is unaffected.
  suppressInvitationNotification: z.boolean().optional(),
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

export const TenantProfileUpdateSchema = z.object({
  name: z.string().min(1).max(SHORT_TEXT).trim().optional(),
  phone: z.string().max(20).optional(),
  verification_token: z.string().max(1024).optional(),
  emergency_contact: z.string().max(SHORT_TEXT).optional(),
  phone_1: z.string().max(20).optional(),
  phone_2: z.string().max(20).optional(),
  phone_3: z.string().max(20).optional(),
  // aadhaar_number removed - now stored in identification_documents table
  personal_email: z.string().trim().email().max(SHORT_TEXT).optional().nullable(),
  college_name: z.string().max(SHORT_TEXT).optional(),
  roll_number: z.string().max(100).optional(),
  course: z.string().max(SHORT_TEXT).optional().nullable(),
  year_of_study: z.union([z.coerce.number().int().min(1).max(6), z.literal(0)]).optional().nullable(),
  section: z.string().max(100).optional().nullable(),
  branch: z.string().max(SHORT_TEXT).optional(),
  address: z.string().max(LONG_TEXT).optional(),
  permanent_address: z.string().max(LONG_TEXT).optional(),
  temporary_address: z.string().max(LONG_TEXT).optional(),
  date_of_birth: z.string().max(30).optional().nullable(),
  gender: z.enum(["Male", "Female", "Other", "Prefer not to say"]).optional().nullable(),
  nationality: z.string().max(SHORT_TEXT).optional().nullable(),
  pan_number: z.string().max(20).optional().nullable(),
  profile_type: z.enum(["STUDENT", "WORKING_PROFESSIONAL"]).optional(),
  office_name: z.string().max(SHORT_TEXT).optional().nullable(),
  office_location: z.string().max(SHORT_TEXT).optional().nullable(),
  job_role: z.string().max(SHORT_TEXT).optional().nullable(),
  photo_url: z.string().url().max(URL_MAX).optional().nullable(),
  guardian_name: z.string().max(SHORT_TEXT).optional().nullable(),
  guardian_relation: z.string().max(SHORT_TEXT).optional().nullable(),
  guardian_phone: z.string().max(20).optional().nullable(),
  expected_completion_date: z.string().max(30).optional().nullable(),
});

export const ReactivationRequestSchema = z.object({
  notes: z.string().max(500).optional(),
});

