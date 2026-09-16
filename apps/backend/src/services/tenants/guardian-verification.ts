/**
 * Where a tenancy stands on parent/guardian phone verification, and what — if
 * anything — should be done about it.
 *
 * ## Why this is a module and not an `if`
 *
 * Before ADR-212, verification was an unconditional gate enforced in two
 * places that did not know about each other: `saveProfile()` refused the
 * Identity step without an OTP, and `activate()` independently re-checked and
 * threw. Both asked "is there a VERIFIED ParentVerify row for this number",
 * and neither could answer anything else — there was nothing else to answer,
 * because the only two outcomes were "pass" and "cannot continue".
 *
 * Now there are five outcomes, a hostel-level policy, a deadline, and a
 * frontend that has to render the same conclusion the backend enforces. So the
 * decision lives in one pure function that both sides call, for the same
 * reason `resolveGenderRequirement` does: a screen and the validation that
 * accepts it must not be able to drift apart.
 *
 * ## What this module deliberately does NOT do
 *
 * It does not decide whether someone may activate. Nothing here blocks
 * activation — that is the whole point of ADR-212. `PENDING_OVERDUE` means "show
 * the wall on dashboard entry", not "deny entry".
 *
 * PURE MODULE. Takes plain arguments, touches nothing external, runs under
 * `vitest.pure.config.ts`. Keep it that way — the caller does the database
 * reads and hands the answers in.
 */

export type GuardianVerificationPolicy = "MANDATORY" | "OPTIONAL";

export type GuardianVerificationState =
  /** No guardian number on file, and none is required of this tenant. */
  | "NOT_APPLICABLE"
  /** Proved, by OTP or by the guardian's own confirmation. Terminal. */
  | "VERIFIED"
  /** Unverified in an OPTIONAL hostel. Recorded, shown, never chased. */
  | "PENDING_UNCHASED"
  /** Deferred in a MANDATORY hostel, still inside the promised window. */
  | "PENDING_GRACE"
  /** Deferred in a MANDATORY hostel, past the date we said we'd ask again. */
  | "PENDING_OVERDUE";

/**
 * How long a deferral buys, in days.
 *
 * Fixed rather than owner-configurable, on purpose: one knob is a decision an
 * owner makes in three seconds, two knobs is a settings screen nobody opens.
 * Seven days is long enough to cover a parent who is travelling or abroad and
 * short enough that the tenant still connects the prompt to the promise they
 * made when they deferred.
 */
export const GUARDIAN_GRACE_DAYS = 7;

/**
 * Why a tenant deferred. A fixed set rather than free text, because the value
 * of asking is that the owner can *act* on the answer — "no WhatsApp" needs a
 * phone call, "travelling" needs patience, and free text needs reading.
 */
export const GUARDIAN_DEFERRAL_REASONS = [
  "NOT_REACHABLE_NOW",
  "TRAVELLING",
  "NO_WHATSAPP",
  "PREFER_NOT_TO",
] as const;

export type GuardianDeferralReason = (typeof GUARDIAN_DEFERRAL_REASONS)[number];

export function isGuardianDeferralReason(value: unknown): value is GuardianDeferralReason {
  return (GUARDIAN_DEFERRAL_REASONS as readonly string[]).includes(String(value));
}

/**
 * Reads the policy out of a hostel policy (nested `tenant_rules`) or a raw
 * `preferences_config`, tolerating either shape and any absent level — the
 * same contract `isAgreementRequired` offers for its own flag, and for the
 * same reason: callers hold one or the other depending on whether they went
 * through `hostelPolicyService` or read the column directly.
 *
 * An absent flag resolves to MANDATORY, which is what every hostel got
 * unconditionally before ADR-212. A missing setting must not silently stop the
 * product asking.
 */
export function readGuardianVerificationPolicy(source: unknown): GuardianVerificationPolicy {
  const root = source && typeof source === "object" ? (source as Record<string, any>) : {};
  const tenantRules = (root.tenant_rules ?? root.policy?.tenant_rules) as Record<string, any> | undefined;
  return String(tenantRules?.guardian_verification ?? "").toUpperCase() === "OPTIONAL"
    ? "OPTIONAL"
    : "MANDATORY";
}

export interface GuardianVerificationInput {
  policy: GuardianVerificationPolicy;
  /** Whether a guardian number is on file at all. */
  hasGuardianPhone: boolean;
  /** Whether a tenant-scoped proof exists. The caller reads the OTP trail. */
  verified: boolean;
  /** Whether this tenant is one we require a guardian of at all (STUDENT). */
  guardianRequired: boolean;
  /** When the tenant chose to come back to it later, if they ever did. */
  deferredAt: Date | null;
  /** Evaluation time, injected so the deadline is testable. */
  now: Date;
}

export interface GuardianVerificationStatus {
  state: GuardianVerificationState;
  /** When the wall starts appearing. Null whenever nothing is being chased. */
  deadlineAt: Date | null;
  /** Whether a dashboard-entry wall is due. Never means "deny entry". */
  wallDue: boolean;
  /** Whether any surface should nudge at all. False for the whole OPTIONAL path. */
  chased: boolean;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

/**
 * The deadline a deferral created, or null if there is no clock running.
 *
 * Exported because the Identity screen has to promise the date *at the moment
 * of deferring* — "we'll ask again on 23 Sep" — before any row has been
 * written, so it cannot read the answer back off a status.
 */
export function guardianDeadline(deferredAt: Date | null): Date | null {
  return deferredAt ? addDays(deferredAt, GUARDIAN_GRACE_DAYS) : null;
}

export function resolveGuardianVerification(
  input: GuardianVerificationInput,
): GuardianVerificationStatus {
  const idle: GuardianVerificationStatus = {
    state: "NOT_APPLICABLE",
    deadlineAt: null,
    wallDue: false,
    chased: false,
  };

  if (input.verified) {
    return { ...idle, state: "VERIFIED" };
  }

  // Nothing to verify and nothing required. A working professional who never
  // gave a guardian number is complete, not pending — flagging them would be
  // inventing an obligation the hostel never asked for.
  if (!input.hasGuardianPhone && !input.guardianRequired) {
    return idle;
  }

  if (input.policy === "OPTIONAL") {
    // Recorded, badged, never chased — so no deadline is computed even if a
    // deferral timestamp happens to be on the row from a period when this
    // hostel was MANDATORY. An owner relaxing the policy must actually relax
    // it, not leave a clock ticking invisibly.
    return { ...idle, state: "PENDING_UNCHASED" };
  }

  const deadlineAt = guardianDeadline(input.deferredAt);

  // A MANDATORY tenancy with no deferral on record is one that has not been
  // asked yet — mid-onboarding, or created before this feature existed. It is
  // pending and chased, but its clock has not started, so it cannot be overdue.
  if (!deadlineAt) {
    return { state: "PENDING_GRACE", deadlineAt: null, wallDue: false, chased: true };
  }

  const overdue = input.now.getTime() >= deadlineAt.getTime();
  return {
    state: overdue ? "PENDING_OVERDUE" : "PENDING_GRACE",
    deadlineAt,
    wallDue: overdue,
    chased: true,
  };
}

/**
 * Whether the wall should actually be shown on *this* dashboard entry.
 *
 * Separate from `wallDue` because being overdue is a state, while showing the
 * wall is an event with a frequency. The rule is back off, don't escalate: the
 * wall appears the first time it comes due, then on every third entry after
 * that. Volume is what turns a reminder into noise a person learns to dismiss
 * without reading, and a tenant who has seen it twice already knows what it
 * says.
 */
export function shouldShowGuardianWall(status: GuardianVerificationStatus, promptCount: number): boolean {
  if (!status.wallDue) return false;
  if (promptCount <= 0) return true;
  return promptCount % 3 === 0;
}
