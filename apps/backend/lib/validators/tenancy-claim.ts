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

/**
 * SECURITY (final security review, finding 1): the opaque token returned by
 * `POST /auth/verify-phone-otp` when `purpose: "TENANCY_CLAIM"` verifies.
 * Optional at this schema layer the same way `password` is below — whether
 * it's actually required is a runtime decision the service enforces
 * (`assertValidClaimProof` refuses with `OTP_PROOF_REQUIRED` when it's
 * missing or doesn't match), not something this layer can see. Loosely
 * bounded rather than a fixed length, since the token's exact encoding is an
 * implementation detail of `generateClaimProofToken`.
 */
const claimTokenField = z.string().min(1).max(255).optional();

export const TenancyClaimLookupSchema = z.object({
  phone: phoneField,
  claim_token: claimTokenField,
});

/**
 * `acknowledgements` mirrors activation's `REQUIRED_ACKNOWLEDGEMENTS` gate —
 * validated for completeness in `tenancyClaimService.confirm`, not here;
 * this layer only shapes the wire format (a map of ack-key to boolean).
 * `name`/`email` let the tenant supply their own details instead of
 * inheriting the owner's placeholder (`+91XXXXXXXXXX@hms.temp`); both are
 * optional, and blank strings are treated as absent by the service.
 */
export const TenancyClaimConfirmSchema = z.object({
  phone: phoneField,
  claim_token: claimTokenField,
  tenant_id: z.string().uuid({ message: "Invalid tenant id" }),
  acknowledgements: z.record(z.string(), z.boolean()).optional(),
  typed_signature_name: z.string().trim().min(1).max(200).optional(),
  name: z.string().trim().min(1).max(200).optional(),
  email: z.string().trim().email({ message: "Invalid email address" }).optional(),
  /**
   * Same length floor as `ActivationSchema.password`
   * (`src/validators/tenants/index.ts`) — deliberately the same policy, not
   * a new one. Optional at this layer because whether it's actually
   * required depends on runtime state this schema can't see: required when
   * `confirm` is about to create or attach an account for an
   * unauthenticated claimant, rejected when the caller already has a
   * session. `tenancyClaimService.confirm` enforces both; this layer only
   * shapes the wire format. `confirm_password` mirrors the activation
   * route's own match check (`app/api/tenants/activate/route.ts`), applied
   * the same way in `app/api/tenancy-claim/confirm/route.ts`.
   */
  password: z.string().min(8).optional(),
  confirm_password: z.string().min(8).optional(),
});
