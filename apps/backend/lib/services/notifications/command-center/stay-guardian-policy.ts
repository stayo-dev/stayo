import type { ConsentState } from "@/src/services/stay/stay-guardian-consent-state";

/**
 * Whether one stay event tells a guardian anything (ADR-233).
 *
 * The shape follows `guardian-reminder-policy.ts` deliberately: the rule is a
 * pure function returning its own reason, so "why did / didn't they get this"
 * is answerable from a log line rather than a re-run. With no test database in
 * this repo, a pure module is also the only part of this slice that is
 * genuinely verified before it ships.
 *
 * ── Why only two event types ──
 *
 * `RETURN_DATE_CHANGED` and `LEAVE_CANCELLED` are amendments to a plan, and
 * forwarding every amendment is how a reassuring channel becomes a noisy one.
 *
 * `LATE` is the important one, and it is deliberately absent. Silence =
 * Present is trust-based and self-reported: a resident who came back at 2am
 * and never tapped *I'm back* is indistinguishable from one who did not come
 * back at all. A late template turns that ambiguity into "your child is not
 * where they said they would be", sent to a parent, on the strength of a
 * missed tap — and no phone has ever scanned the Stay QR in production, so
 * the real missed-tap rate is not merely unmeasured, it is unobserved. Late
 * returns stay on the owner's board, where a human reads them in context.
 */

const NOTIFIABLE: Record<string, "LEAVE" | "RETURN"> = {
  LEAVE_STARTED: "LEAVE",
  RETURNED: "RETURN",
};

export type StayGuardianReason =
  | "LEAVE"
  | "RETURN"
  | "NOT_NOTIFIABLE"
  | "NO_GUARDIAN_PHONE"
  | "SAME_AS_RESIDENT"
  | "NO_CONSENT"
  | "DECLINED"
  | "REVOKED"
  | "STOPPED_BY_GUARDIAN"
  | "PHONE_CHANGED_SINCE_CONSENT"
  | "GUARDIAN_UNVERIFIED";

export type StayGuardianDecision = { notify: boolean; reason: StayGuardianReason };

const CONSENT_REFUSALS: Record<string, StayGuardianReason> = {
  UNASKED: "NO_CONSENT",
  DECLINED: "DECLINED",
  REVOKED: "REVOKED",
  STOPPED: "STOPPED_BY_GUARDIAN",
  PHONE_CHANGED: "PHONE_CHANGED_SINCE_CONSENT",
};

export function decideStayGuardianNotice(input: {
  eventType: string;
  consentState: ConsentState;
  guardianPhone: string | null | undefined;
  residentPhone: string;
  guardianVerified: boolean;
  /** Compares normalised digits — the schema stores phone numbers inconsistently. */
  normalise: (phone: string) => string;
}): StayGuardianDecision {
  const { eventType, consentState, guardianPhone, residentPhone, guardianVerified, normalise } = input;

  // First, so an unrelated event never becomes a consent question.
  const kind = NOTIFIABLE[eventType];
  if (!kind) return { notify: false, reason: "NOT_NOTIFIABLE" };

  if (!guardianPhone || !String(guardianPhone).trim()) {
    return { notify: false, reason: "NO_GUARDIAN_PHONE" };
  }

  // One handset listed in both fields must not receive the same message twice.
  if (residentPhone && normalise(String(guardianPhone)) === normalise(residentPhone)) {
    return { notify: false, reason: "SAME_AS_RESIDENT" };
  }

  const refusal = CONSENT_REFUSALS[consentState];
  if (refusal) return { notify: false, reason: refusal };

  // Same rule as every financial answer: an unverified number is not told
  // this family's business — and movements are more sensitive than a balance.
  if (!guardianVerified) return { notify: false, reason: "GUARDIAN_UNVERIFIED" };

  return { notify: true, reason: kind };
}
