/**
 * Guardian verification.
 *
 * A guardian is recognised by their phone number appearing in
 * `tenants.guardian_phone` — a field an owner types in by hand, from a form,
 * often at speed. One transposed digit and a stranger's handset is holding a
 * family's rent ledger, payment links included. The old system treated that
 * match as sufficient on its own: it computed `senderRole: "GUARDIAN"` in four
 * separate places and used the result for nothing but an audit-log string.
 *
 * So a phone match opens the conversation but does not open the account. The
 * first time a guardian asks anything financial, a six-digit code goes to that
 * same handset and has to come back. It re-verifies every 90 days.
 *
 * A guardian verified during the tenant's onboarding is already through this
 * gate — see `ACCEPTED_VERIFICATION_PURPOSES` — so the [Help] button on
 * `stayo_guardian_whatsapp_activated` opens the menu on the first tap rather
 * than opening a second OTP.
 *
 * Nothing here is new machinery: it composes `authOtpService`, which already
 * owns generation, hashing, rate limiting, attempt caps, the provider circuit
 * breaker, and the audit trail. `phone_verification_otps` rows carry
 * `purpose` and `verified_at`, so the 90-day window is a query against
 * evidence we already record rather than a new table.
 *
 * ADR-113 in [[Decisions]]. This is a *messaging* identity and grants no login:
 * `schema.prisma`'s "parent/guardian logins are explicitly out of scope — there
 * is no second account here" still holds, and this deliberately does not
 * challenge it.
 */

import { prisma } from "@/lib/db";
import { getLogger } from "@/lib/logger";
import { authOtpService, OtpServiceError } from "@/lib/services/auth/auth-otp-service";
import { normalizeWhatsAppPhone } from "@/lib/services/notifications/providers/whatsapp";
import { lines } from "./voice";

const logger = getLogger("whatsapp.command-center.guardian-access");

/** Matches `otpPurposeLabel`'s "guardian access" entry in `meta-provider.ts`. */
export const GUARDIAN_OTP_PURPOSE = "GUARDIAN_ACCESS";

/**
 * The onboarding purpose, which counts as guardian verification too.
 *
 * When a tenant adds their guardian during activation, a code goes to the
 * guardian's handset and has to come back before the tenant can activate at
 * all (`activation-workflow-service.completeProfile`) — the same proof this
 * module asks for, to a standard the product already trusts for a *gating*
 * decision, not merely a read.
 *
 * Accepting it is not a convenience. `stayo_guardian_whatsapp_activated` is
 * sent the moment that verification lands, and it invites the guardian to tap
 * [Help]. Recognising only `GUARDIAN_ACCESS` would answer that tap by sending
 * a second code to a handset that had verified minutes earlier — turning the
 * channel's introduction into a chore, which is precisely what the button was
 * added to avoid.
 *
 * The distinction is real and worth stating: `ParentVerify` proves the number
 * was reachable and that someone there cooperated, whereas `GUARDIAN_ACCESS`
 * proves the person holding it *now* asked for access. Both expire into the
 * same 90-day window below, after which the stronger challenge is issued.
 */
export const ONBOARDING_OTP_PURPOSE = "ParentVerify";

/** Every purpose that proves this handset is the guardian's. */
export const ACCEPTED_VERIFICATION_PURPOSES = [
  GUARDIAN_OTP_PURPOSE,
  ONBOARDING_OTP_PURPOSE,
] as const;

/**
 * How long one verification lasts. Long enough that a parent paying monthly
 * is challenged twice a year rather than twice a month; short enough that a
 * number reassigned by a telecom operator — India recycles disconnected
 * numbers after 90 days — cannot inherit access indefinitely.
 */
export const VERIFICATION_VALID_DAYS = 90;

/** A six-digit code on its own line and nothing else. */
export function looksLikeOtp(body: string): boolean {
  return /^\s*\d{6}\s*$/.test(String(body || ""));
}

export function extractOtp(body: string): string | null {
  const match = String(body || "").match(/^\s*(\d{6})\s*$/);
  return match ? match[1] : null;
}

/**
 * Has this phone completed guardian verification inside the window?
 *
 * Reads the OTP audit trail rather than a status column, so there is exactly
 * one record of what happened and no second thing to keep in sync with it.
 */
export async function isGuardianVerified(phone: string): Promise<boolean> {
  const normalized = normalizeWhatsAppPhone(phone);
  const cutoff = new Date(Date.now() - VERIFICATION_VALID_DAYS * 24 * 60 * 60 * 1000);

  const verified = await (prisma as any).phoneVerificationOtp.findFirst({
    where: {
      phone: normalized,
      // Either proof, inside the window — see ACCEPTED_VERIFICATION_PURPOSES.
      purpose: { in: [...ACCEPTED_VERIFICATION_PURPOSES] },
      status: "VERIFIED",
      verified_at: { gte: cutoff },
    },
    orderBy: { verified_at: "desc" },
    select: { id: true, purpose: true, verified_at: true },
  });

  return Boolean(verified);
}

export type ChallengeResult =
  | { status: "SENT"; expiresInSeconds: number | null }
  | { status: "RATE_LIMITED"; message: string }
  | { status: "UNAVAILABLE"; message: string };

/**
 * Send the code. Failures are returned, not thrown, because every one of them
 * still owes the guardian a reply — a silent WhatsApp thread is the worst
 * possible outcome for someone trying to pay rent.
 */
export async function sendGuardianChallenge(phone: string): Promise<ChallengeResult> {
  try {
    const result = await authOtpService.sendPhoneOtp({
      phone,
      purpose: GUARDIAN_OTP_PURPOSE,
    });

    // `GUARDIAN_ACCESS` is not in SKIPPABLE_OTP_PURPOSES, so verification is
    // never waived here. If that ever changes, refuse rather than degrade:
    // skipping this check would hand a family's finances to an unverified
    // number, which is a different order of risk from an owner signup stalling.
    if (result.verification_required === false) {
      logger.error("guardian_access.challenge_skipped", { reason: result.reason || null });
      return {
        status: "UNAVAILABLE",
        message: guardianUnavailableMessage(),
      };
    }

    return { status: "SENT", expiresInSeconds: result.expires_in_seconds ?? null };
  } catch (error: any) {
    if (error instanceof OtpServiceError && error.status === 429) {
      return {
        status: "RATE_LIMITED",
        message: lines(
          "A code was already sent to this number a moment ago.",
          "",
          "Please enter that code, or wait a few minutes and send RENT again to get a new one."
        ),
      };
    }

    logger.error("guardian_access.challenge_failed", {
      code: error?.code || null,
      error: error?.message || String(error),
    });
    return { status: "UNAVAILABLE", message: guardianUnavailableMessage() };
  }
}

export type VerifyResult =
  | { status: "VERIFIED" }
  | { status: "REJECTED"; message: string };

export async function verifyGuardianCode(phone: string, otp: string): Promise<VerifyResult> {
  try {
    await authOtpService.verifyPhoneOtp({ phone, otp, purpose: GUARDIAN_OTP_PURPOSE });
    logger.info("guardian_access.verified", { valid_days: VERIFICATION_VALID_DAYS });
    return { status: "VERIFIED" };
  } catch (error: any) {
    const code = error instanceof OtpServiceError ? error.code : "OTP_INVALID";
    return { status: "REJECTED", message: rejectionMessage(code) };
  }
}

// ─── Copy ────────────────────────────────────────────────────
//
// Framed as protection *of* the family, not as suspicion of the reader. A
// parent asked for a code before seeing their child's rent should finish
// reading with more confidence in the hostel, not less.

export function challengeMessage(residentNames: string[]): string {
  const who =
    residentNames.length === 1
      ? `*${residentNames[0]}*`
      : residentNames.length > 1
        ? `*${residentNames.join("*, *")}*`
        : "the resident";

  return lines(
    `This number is listed as the guardian contact for ${who}.`,
    "",
    "Before we share rent details or payment links, we confirm the number belongs to you. We have sent a 6-digit code to this handset.",
    "",
    "Reply with the code to continue. It is valid for 5 minutes.",
    "",
    "_We ask once every 90 days, not every time._"
  );
}

export function verifiedMessage(): string {
  return lines(
    "Verified — thank you.",
    "",
    "You can now check rent, view instalment progress, and pay from this chat."
  );
}

function rejectionMessage(code: string): string {
  if (code === "OTP_MAX_ATTEMPTS" || code === "OTP_LOCKED") {
    return lines(
      "That code has been entered incorrectly too many times, so it is now closed.",
      "",
      "Send *RENT* to start again with a fresh code."
    );
  }

  if (code === "OTP_REPLAY_BLOCKED") {
    return "That code is already being checked. Give it a moment.";
  }

  return lines(
    "That code is not right, or it has expired.",
    "",
    "Check the most recent message for the code, or send *RENT* to get a new one."
  );
}

function guardianUnavailableMessage(): string {
  return lines(
    "We could not send a verification code to this number just now.",
    "",
    "Please try again shortly. If it keeps happening, contact the hostel directly and they can share the rent details and collect payment.",
    "",
    "_We do not share rent details with an unverified number, so this step cannot be skipped._"
  );
}
