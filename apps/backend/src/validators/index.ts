import { z } from "zod";

// ─────────────────────────────────────────────────────────────────────────────
// Shared constraints
// ─────────────────────────────────────────────────────────────────────────────

/** bcrypt silently truncates at 72 chars — cap all passwords to prevent confusion */
const PASSWORD_MAX = 72;
/** Reasonable upper bound on any financial amount in INR (₹10 Lakhs) */
const MAX_AMOUNT_INR = 1_000_000;
/** Short text fields (names, labels) */
const SHORT_TEXT = 255;
/** Long text fields (addresses, notes) */
const LONG_TEXT = 1000;
/** URL fields */
const URL_MAX = 2048;

// ─────────────────────────────────────────────────────────────────────────────
// Auth Schemas
// ─────────────────────────────────────────────────────────────────────────────

export const LoginSchema = z.object({
  email: z.string().trim().email().max(SHORT_TEXT),
  password: z.string().min(6).max(PASSWORD_MAX),
});

export const RegisterSchema = z.object({
  email:    z.string().trim().email().max(SHORT_TEXT),
  password: z.string().min(8).max(PASSWORD_MAX),
  name:     z.string().min(2).max(SHORT_TEXT).trim(),
  phone:    z.string().max(20).optional(),
  verification_token: z.string().min(1).max(1024),
  role:     z.enum(["OWNER", "admin"]).optional(), // frontend sends 'admin' as default
});

export const ChangePasswordSchema = z.object({
  old_password: z.string().min(1).max(PASSWORD_MAX),
  new_password: z.string().min(8).max(PASSWORD_MAX),
});

export const ForgotPasswordSchema = z.object({
  email: z.string().trim().email().max(SHORT_TEXT),
});

export const ResetPasswordSchema = z.object({
  code: z.string().min(1).max(4096).optional(),
  access_token: z.string().min(1).max(8192).optional(),
  new_password: z.string().min(8).max(PASSWORD_MAX),
  confirm_password: z.string().min(8).max(PASSWORD_MAX),
}).refine((data) => Boolean(data.code || data.access_token), {
  message: "Reset token is required",
  path: ["code"],
}).refine((data) => data.new_password === data.confirm_password, {
  message: "Passwords do not match",
  path: ["confirm_password"],
});

// ─────────────────────────────────────────────────────────────────────────────
// Tenant & Enrollment Schemas
// ─────────────────────────────────────────────────────────────────────────────

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
  profile_type: z.enum(["STUDENT", "WORKING_PROFESSIONAL"]).optional(),
  office_name: z.string().max(SHORT_TEXT).optional().nullable(),
  office_location: z.string().max(SHORT_TEXT).optional().nullable(),
  job_role: z.string().max(SHORT_TEXT).optional().nullable(),
  photo_url: z.string().url().max(URL_MAX).optional().nullable(),
});

export const ReactivationRequestSchema = z.object({
  notes: z.string().max(500).optional(),
});

// ─────────────────────────────────────────────────────────────────────────────
// Property & Room Schemas
// ─────────────────────────────────────────────────────────────────────────────

export const RoomCreateSchema = z.object({
  room_no: z.string().min(1).max(50).trim(),
  capacity: z.coerce.number().int().positive().max(20),
  floor: z.coerce.number().int().min(0).max(200).optional(),
  room_type: z.string().max(100).optional(),
  base_rent: z.coerce.number().nonnegative().max(MAX_AMOUNT_INR).optional(),
  floor_id: z.string().uuid().optional(),
  wifi_name: z.string().max(100).optional(),
  wifi_password: z.string().max(100).optional(),
  notes: z.string().max(LONG_TEXT).optional(),
});

export const AllocationSchema = z.object({
  tenant_id: z.string().uuid(),
  room_id: z.string().uuid(),
  start_date: z.string().max(30).transform((val: string) => new Date(val)),
});

// ─────────────────────────────────────────────────────────────────────────────
// Payment & Billing Schemas
// ─────────────────────────────────────────────────────────────────────────────

const VALID_PAYMENT_METHODS = ["CASH", "BANK_TRANSFER", "UPI", "CHEQUE", "OTHER", "ONLINE"] as const;

export const PaymentInitiateSchema = z.object({
  obligation_id: z.string().uuid(),
  amount: z.number().positive().max(MAX_AMOUNT_INR),
  method: z.enum(VALID_PAYMENT_METHODS).default("UPI"),
});

/** Schema for POST /api/payments (manual offline recording) */
export const RecordPaymentSchema = z.object({
  obligation_id: z.string().uuid(),
  amount_paid: z.number().positive().max(MAX_AMOUNT_INR),
  payment_method: z.enum(VALID_PAYMENT_METHODS).default("CASH"),
  reference_number: z.string().max(100).optional().nullable(),
  payment_date: z.string().max(30).optional().nullable(),
  note: z.string().max(500).optional().nullable(),
});

export const ExpenseCreateSchema = z.object({
  title: z.string().min(3).max(SHORT_TEXT).trim(),
  amount: z.number().positive().max(MAX_AMOUNT_INR),
  category: z.string().min(1).max(100),
  date: z.string().max(30).transform((val: string) => new Date(val)),
  notes: z.string().max(LONG_TEXT).optional(),
  vendor_name: z.string().max(SHORT_TEXT).optional(),
  payment_method: z.string().max(50).optional(),
  tags: z.array(z.string().max(50)).max(20).optional(),
});

// ─────────────────────────────────────────────────────────────────────────────
// Invitation Schemas
// ─────────────────────────────────────────────────────────────────────────────

export {
  InvitationSchema,
  InvitationUpdateSchema,
  ActivationSchema,
} from "./tenants";

