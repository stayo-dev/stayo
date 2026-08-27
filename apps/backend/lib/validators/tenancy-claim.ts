import { z } from "zod";
import { normalizeIndianPhone } from "@/lib/utils/phone-utils";

/**
 * Validators for the tenancy-claim flow
 * (`POST /api/tenancy-claim/lookup`, `POST /api/tenancy-claim/confirm`).
 *
 * Phone is canonicalised via `normalizeIndianPhone` — E.164 (`+91XXXXXXXXXX`)
 * — deliberately NOT `normalizeWhatsAppPhone`, which `lib/validators/otp.ts`
 * uses for the OTP send/verify endpoints. `tenancy-claim-service.ts` compares
 * the canonical phone against `tenants.phone_1` and `profile.phone`, both of
 * which are written in `normalizeIndianPhone`'s format everywhere else in the
 * codebase (see `owner-managed-tenancy-service.ts`,
 * `tenant-invitation-lifecycle-service.ts`). The service converts back to the
 * WhatsApp digit format only when it queries `phone_verification_otps`, which
 * is written in that format regardless of what the caller sent.
 */
const phoneField = z
  .string()
  .min(8)
  .max(20)
  .transform((value, ctx) => {
    const normalized = normalizeIndianPhone(value);
    if (!normalized) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Invalid phone number",
      });
      return z.NEVER;
    }
    return normalized;
  });

export const TenancyClaimLookupSchema = z.object({
  phone: phoneField,
});

export const TenancyClaimConfirmSchema = z.object({
  phone: phoneField,
  tenant_id: z.string().uuid({ message: "Invalid tenant id" }),
});
