import { z } from "zod";
import { normalizeWhatsAppPhone } from "@/lib/services/notifications/providers/whatsapp";

export const PHONE_VERIFICATION_PURPOSE = "PHONE_VERIFICATION";

export const SendPhoneOtpSchema = z.object({
  phone: z.string().min(8).max(20).transform((value, ctx) => {
    try {
      return normalizeWhatsAppPhone(value);
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Invalid phone number",
      });
      return z.NEVER;
    }
  }),
  purpose: z.string().optional().default(PHONE_VERIFICATION_PURPOSE),
});

export const VerifyPhoneOtpSchema = z.object({
  phone: z.string().min(8).max(20).transform((value, ctx) => {
    try {
      return normalizeWhatsAppPhone(value);
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Invalid phone number",
      });
      return z.NEVER;
    }
  }),
  otp: z.string().regex(/^\d{6}$/, "OTP must be a 6 digit code"),
  purpose: z.string().optional().default(PHONE_VERIFICATION_PURPOSE),
});
