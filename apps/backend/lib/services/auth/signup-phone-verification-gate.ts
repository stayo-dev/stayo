import { prisma } from "@/lib/db";

/**
 * Both signup entry points (POST /api/leads/self-serve and
 * POST /api/auth/owner-signup) require the caller to have just gone through
 * POST /api/auth/send-phone-otp for this exact number. That endpoint writes
 * either a VERIFIED row (a real code was entered) or a SKIPPED row (WhatsApp
 * could not deliver — see phone-verification-mode.ts). Both are accepted; the
 * difference is recorded, not enforced.
 */
export const SIGNUP_OTP_FRESHNESS_MS = 30 * 60 * 1000;

const ACCEPTED_STATUSES = ["VERIFIED", "SKIPPED"];

export type SignupPhoneVerification = { ok: true; phoneVerified: boolean } | { ok: false };

export async function resolveSignupPhoneVerification(
  normalizedPhone: string,
  purpose: string,
  now = Date.now(),
): Promise<SignupPhoneVerification> {
  const record = await (prisma as any).phoneVerificationOtp.findFirst({
    where: {
      phone: normalizedPhone,
      purpose,
      status: { in: ACCEPTED_STATUSES },
    },
    orderBy: { created_at: "desc" },
  });

  const verifiedAt = record?.verified_at ? new Date(record.verified_at).getTime() : null;
  if (!verifiedAt || now - verifiedAt >= SIGNUP_OTP_FRESHNESS_MS) return { ok: false };

  return { ok: true, phoneVerified: record.status === "VERIFIED" };
}
