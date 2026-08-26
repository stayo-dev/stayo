import crypto from "crypto";
import { prisma } from "@/lib/db";
import { safeRedis, isRedisConfigured } from "@/lib/redis/client";
import { EmailService } from "@/lib/services/email-service";
import { profilePhoneCandidates } from "@/lib/services/auth/auth-otp-service";

/**
 * Proving a contact detail belongs to the person changing it.
 *
 * ## What replaced owner approval
 *
 * Changing your own phone or email used to require your hostel owner to
 * approve it — a queue that held **0 rows, ever**, standing between a resident
 * and the number our WhatsApp messages go to. That is gone (ADR-119). What
 * remains is the part that was actually load-bearing: **a contact detail we
 * hold should be one that reaches you.** So a new value has to be proved, by
 * the person changing it, with a code sent to the new value itself.
 *
 * That is a different thing from a permission. Nobody decides whether you may
 * change your number; you just have to show us it is yours.
 *
 * ## Phone and email are proved differently, for a reason
 *
 * Phone reuses `phone_verification_otps`, which already exists and already
 * carries rate limits, attempt caps and a WhatsApp delivery path. Email has
 * no such table and building one would need a migration, which this project
 * applies by hand — so email codes live in **Redis** with a TTL, which is the
 * right storage for a secret that is meant to expire in ten minutes anyway.
 *
 * ## Degrading honestly
 *
 * If WhatsApp cannot deliver, `auth-otp-service` already answers
 * `verification_required: false` (ADR-034) and callers save the change rather
 * than waiting for a code that is not coming. Email does the same when Resend
 * is unconfigured, and — importantly — **when Redis is not configured at all**:
 * a verification we cannot store is a verification we cannot check, and
 * refusing every email change on infrastructure grounds would be a worse
 * failure than accepting it unproved.
 */

const CODE_TTL_SECONDS = 10 * 60;
/** How long a proof stays good — long enough to finish a form, short enough to matter. */
const PROOF_TTL_SECONDS = 15 * 60;
const MAX_ATTEMPTS = 5;

function normaliseEmail(email: string): string {
  return String(email ?? "").trim().toLowerCase();
}

/** Emails are not safe as raw Redis key segments; a hash is, and is short. */
function emailKey(profileId: string, email: string): string {
  const digest = crypto.createHash("sha256").update(normaliseEmail(email)).digest("hex").slice(0, 24);
  return `contact:email:${profileId}:${digest}`;
}

function sixDigits(): string {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
}

export class ContactVerificationError extends Error {
  constructor(public code: string, message: string, public status = 400) {
    super(message);
    this.name = "ContactVerificationError";
  }
}

export async function startEmailVerification(input: {
  profileId: string;
  email: string;
}): Promise<{ verification_required: boolean; reason?: string }> {
  const email = normaliseEmail(input.email);
  if (!email || !email.includes("@")) {
    throw new ContactVerificationError("VALIDATION_ERROR", "Enter a valid email address");
  }

  // No store means no check later. Say so rather than pretending.
  if (!isRedisConfigured()) {
    return { verification_required: false, reason: "STORE_NOT_CONFIGURED" };
  }

  const code = sixDigits();
  const stored = await safeRedis(
    "contact.email.start",
    (redis) =>
      redis
        .set(`${emailKey(input.profileId, email)}:code`, JSON.stringify({ code, attempts: 0 }), {
          ex: CODE_TTL_SECONDS,
        })
        .then(() => true),
    false,
  );

  if (!stored) return { verification_required: false, reason: "STORE_UNAVAILABLE" };

  const result = await EmailService.sendEmail(
    email,
    `${code} is your Stayo verification code`,
    `<div style="font-family:system-ui,-apple-system,sans-serif;color:#221E1A">
       <p style="font-size:15px">Here is the code to confirm this email address on your Stayo account:</p>
       <p style="font-size:30px;font-weight:800;letter-spacing:.18em;color:#B46A55;margin:18px 0">${code}</p>
       <p style="font-size:13px;color:#8A7F75">It expires in 10 minutes. If you didn't ask to change your email, you can ignore this — nothing has changed.</p>
     </div>`,
  );

  // Same contract as the WhatsApp leg: a code that could not be sent is not a
  // code the caller should wait for.
  if (result && (result as any).sent === false) {
    return { verification_required: false, reason: "PROVIDER_NOT_CONFIGURED" };
  }

  return { verification_required: true };
}

export async function confirmEmailVerification(input: {
  profileId: string;
  email: string;
  code: string;
}): Promise<void> {
  const email = normaliseEmail(input.email);
  const key = emailKey(input.profileId, email);

  const raw = await safeRedis<string | null>(
    "contact.email.read",
    (redis) => redis.get(`${key}:code`) as Promise<string | null>,
    null,
  );
  if (!raw) {
    throw new ContactVerificationError("OTP_EXPIRED", "That code has expired. Ask for a new one.");
  }

  const record = typeof raw === "string" ? JSON.parse(raw) : (raw as any);
  if (Number(record.attempts ?? 0) >= MAX_ATTEMPTS) {
    throw new ContactVerificationError("TOO_MANY_ATTEMPTS", "Too many attempts. Ask for a new code.", 429);
  }

  if (String(record.code) !== String(input.code ?? "").trim()) {
    await safeRedis(
      "contact.email.attempt",
      (redis) =>
        redis
          .set(`${key}:code`, JSON.stringify({ ...record, attempts: Number(record.attempts ?? 0) + 1 }), {
            ex: CODE_TTL_SECONDS,
          })
          .then(() => true),
      false,
    );
    throw new ContactVerificationError("OTP_INVALID", "That code did not match.");
  }

  await safeRedis(
    "contact.email.prove",
    (redis) =>
      Promise.all([
        redis.set(`${key}:proven`, "1", { ex: PROOF_TTL_SECONDS }),
        redis.del(`${key}:code`),
      ]).then(() => true),
    false,
  );
}

/** Has this profile proved this email recently? */
export async function isEmailProven(profileId: string, email: string): Promise<boolean> {
  if (!isRedisConfigured()) return true; // see "Degrading honestly" above
  const value = await safeRedis<string | null>(
    "contact.email.proven",
    (redis) => redis.get(`${emailKey(profileId, email)}:proven`) as Promise<string | null>,
    null,
  );
  return Boolean(value);
}

/**
 * Has this number been proved recently?
 *
 * Read straight from `phone_verification_otps` rather than a separate marker,
 * so the phone leg has exactly one source of truth. `profilePhoneCandidates`
 * is what makes `7013216327` and `+917013216327` the same number — the
 * formatting mismatch that made ADR-110 inert once already.
 */
export async function isPhoneProven(phone: string): Promise<boolean> {
  const candidates = profilePhoneCandidates(String(phone ?? "").trim());
  if (candidates.length === 0) return false;

  const since = new Date(Date.now() - PROOF_TTL_SECONDS * 1000);
  const verified = await (prisma as any).phoneVerificationOtp.findFirst({
    where: { phone: { in: candidates }, verified_at: { gte: since } },
    select: { id: true },
  });
  return Boolean(verified);
}
