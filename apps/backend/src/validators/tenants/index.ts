import { z } from "zod";

const MAX_AMOUNT_INR = 1_000_000;

export const optionalNumber = (maxVal: number = MAX_AMOUNT_INR) =>
  z.preprocess((val) => {
    if (val === "" || val === null || val === undefined) return undefined;
    const num = Number(val);
    return isNaN(num) ? undefined : num;
  }, z.number().nonnegative().max(maxVal).optional());

export const requiredNumber = (maxVal: number = MAX_AMOUNT_INR) =>
  z.preprocess((val) => {
    if (val === "" || val === null || val === undefined) return undefined;
    const num = Number(val);
    return isNaN(num) ? undefined : num;
  }, z.number().nonnegative().max(maxVal));

export const optionalPositiveNumber = (maxVal: number = MAX_AMOUNT_INR) =>
  z.preprocess((val) => {
    if (val === "" || val === null || val === undefined) return undefined;
    const num = Number(val);
    return isNaN(num) || num <= 0 ? undefined : num;
  }, z.number().positive().max(maxVal).optional());

export const optionalInteger = (maxVal?: number) => {
  let schema = z.number().int();
  if (maxVal !== undefined) {
    schema = schema.max(maxVal);
  }
  return z.preprocess((val) => {
    if (val === "" || val === null || val === undefined) return undefined;
    const num = Number(val);
    return isNaN(num) || !Number.isInteger(num) ? undefined : num;
  }, schema.optional());
};

export const optionalPositiveInteger = (maxVal?: number) => {
  let schema = z.number().int().positive();
  if (maxVal !== undefined) {
    schema = schema.max(maxVal);
  }
  return z.preprocess((val) => {
    if (val === "" || val === null || val === undefined) return undefined;
    const num = Number(val);
    return isNaN(num) || !Number.isInteger(num) || num <= 0 ? undefined : num;
  }, schema.optional());
};

export const TenantProfileUpdateSchema = z.object({
  name: z.string().optional(),
  phone: z.string().optional(),
  verification_token: z.string().optional(),
  emergency_contact: z.string().optional(),
  phone_1: z.string().optional(),
  phone_2: z.string().optional(),
  phone_3: z.string().optional(),
  phone_1_otp: z.string().optional(),
  phone_2_otp: z.string().optional(),
  phone_3_otp: z.string().optional(),
  // aadhaar_number removed - now stored in identification_documents table
  personal_email: z.string().trim().email().optional().nullable(),
  college_name: z.string().optional(),
  roll_number: z.string().optional(),
  course: z.string().optional().nullable(),
  year_of_study: z.preprocess(
    (val) => (val === "" || val === null || val === undefined ? null : val),
    z.union([z.coerce.number().int().min(1).max(6), z.literal(0)]).optional().nullable()
  ),
  section: z.string().optional().nullable(),
  branch: z.string().optional(),
  address: z.string().optional(),
  permanent_address: z.string().optional(),
  temporary_address: z.string().optional(),
  date_of_birth: z.string().optional().nullable(),
  gender: z.enum(["Male", "Female", "Other", "Prefer not to say"]).optional().nullable(),
  profile_type: z.enum(["STUDENT", "WORKING_PROFESSIONAL"]).optional(),
  office_name: z.string().optional().nullable(),
  office_location: z.string().optional().nullable(),
  job_role: z.string().optional().nullable(),
  photo_url: z.string().optional().nullable(),
});

export const ReactivationRequestSchema = z.object({
  notes: z.string().max(500).optional(),
});

export const InvitationSchema = z.object({
  email: z.string().trim().email().optional().or(z.literal("")).nullable(),
  name: z.string().min(2),
  phone: z.string().min(1),
  room_id: z.string().uuid(),
  monthly_rent: optionalNumber(),
  advance_amount: optionalNumber(),
  minimum_deposit_threshold: optionalNumber(),
  maintenance_amount: optionalNumber(),
  joining_date: z.string().optional(),            // ISO date string, defaults to today
  maintenance_type: z.enum(["MONTHLY", "ONE_TIME", "NONE"]).optional(), // defaults to hostel billing policy
  agreement_duration_months: optionalPositiveInteger(120),
  agreement_start_date: z.string().max(30).optional(),
  payment_frequency: z.enum(["MONTHLY", "QUARTERLY", "HALF_YEARLY", "ACADEMIC_YEARLY", "CUSTOM_INSTALLMENTS"]).optional(),
});

export const InvitationUpdateSchema = z.object({
  email: z.string().trim().email().optional().or(z.literal("")).nullable(),
  name: z.string().min(2),
  phone: z.string().min(1),
  room_id: z.string().uuid(),
  monthly_rent: optionalNumber(),
  advance_amount: optionalNumber(),
  minimum_deposit_threshold: optionalNumber(),
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

