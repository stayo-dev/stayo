import { z } from "zod";

// --- Auth Schemas ---
export const LoginSchema = z.object({
  email: z.string().trim().min(3, "Email or phone number is required").refine(
    (val) => {
      const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val);
      const isPhone = /^\+?[0-9\s-]{10,20}$/.test(val);
      return isEmail || isPhone;
    },
    { message: "Must be a valid email or phone number" }
  ),
  password: z.string().min(6),
});

export const RegisterSchema = z.object({
  email:    z.string().email(),
  password: z.string().min(8).max(64),
  name:     z.string().min(2),
  phone:    z.string().optional(),
  verification_token: z.string().min(1),
  role:     z.enum(["OWNER", "admin"]).optional(), // frontend sends 'admin' as default
});

export const OwnerSignupSchema = z.object({
  email:      z.string().trim().email(),
  password:   z.string().min(8).max(64),
  name:       z.string().min(2),
  phone:      z.string().min(8).max(20),
  lead_token: z.string().min(1).optional(), // owner-acquisition funnel phase 2 — see lead-invitation-service.ts
});

/**
 * Self-serve tenant signup — a marketplace account (browse/save/enquire), not
 * a tenant *of a hostel*. No `lead_token` equivalent: a tenant becomes a real
 * resident only via an owner's invitation + activation. See ADR-035.
 */
export const TenantSignupSchema = z.object({
  email:    z.string().trim().email(),
  password: z.string().min(8).max(64),
  name:     z.string().min(2),
  phone:    z.string().min(8).max(20),
});

export const ChangePasswordSchema = z.object({
  old_password: z.string().min(1),
  new_password: z.string().min(8),
});

// Real Google-auth lead capture on the landing page — self-serve, public,
// OTP-gated (see app/api/leads/self-serve/route.ts).
export const LeadSelfServeSchema = z.object({
  name: z.string().trim().min(2),
  hostel_name: z.string().trim().min(2),
  phone: z.string().trim().min(8).max(20),
  google_email: z.string().trim().email().optional(),
  city: z.string().trim().optional(),
  bed_count: z.number().int().positive().optional(),
});

export const ForgotPasswordSchema = z.object({
  email: z.string().trim().email().max(255),
});

export const ResetPasswordSchema = z.object({
  code: z.string().min(1).max(4096).optional(),
  access_token: z.string().min(1).max(8192).optional(),
  new_password: z.string().min(8).max(72),
  confirm_password: z.string().min(8).max(72),
}).refine((data) => Boolean(data.code || data.access_token), {
  message: "Reset token is required",
  path: ["code"],
}).refine((data) => data.new_password === data.confirm_password, {
  message: "Passwords do not match",
  path: ["confirm_password"],
});

// --- Tenant & Enrollment Schemas ---
export { 
  TenantProfileUpdateSchema, 
  ReactivationRequestSchema 
} from "../../src/validators/tenants";

// --- Property & Room Schemas ---
// Re-exported from domain validators
export { RoomCreateSchema, AllocationSchema } from "../../src/validators/rooms";

// --- Payment & Billing Schemas ---
export {
  PaymentInitiateSchema,
  ExpenseCreateSchema
} from "../../src/validators/payments";

// --- Invitation Schemas ---
export { 
  InvitationSchema, 
  InvitationUpdateSchema, 
  ActivationSchema 
} from "../../src/validators/tenants";
