/**
 * The Add Hostel builder's last question: does this hostel use a tenant
 * agreement, and — if so — has the owner actually signed it once?
 *
 * `AgreementTemplate` and `tenant_rules.agreement_required` are already
 * hostel-scoped in the backend (not room-scoped — there is no per-room
 * agreement concept anywhere in this codebase), and a signed template's
 * `owner_signature_url` is already copied onto every tenant's `Agreement` row
 * automatically at generation time (`agreement-generation-service.ts`) — an
 * owner is never asked to sign per tenant. The one real gap this step closes:
 * nothing in the product ever asked the owner to make this decision or
 * capture a signature, so a hostel that kept the default `agreement_required:
 * true` and was never visited under Configuration › Agreements silently ended
 * up generating tenant agreements with no owner signature at all (see
 * `getActiveTemplateAndSyncRuleVersion`'s auto-create fallback).
 *
 * Pure, matching the rest of this feature (`hostelBuilder.ts`,
 * `builderJourney.ts`) — this app's test suite is node-only, no DOM.
 */

export type AgreementChoice = 'yes' | 'no' | null;

/**
 * Whether the owner has already made and completed this decision for this
 * hostel, so the builder never re-asks on a resumed build.
 *
 * "Settled" means either an explicit "No" is on record, or "Yes" plus a
 * signature that actually exists on the active template — a hostel sitting on
 * the untouched default (`agreementRequired: true`, no signature yet) is
 * deliberately NOT settled, because that is exactly the silent gap this step
 * exists to close.
 */
export function isAgreementSettled(state: {
  agreementRequired: boolean;
  signatureConfigured: boolean;
}): boolean {
  if (!state.agreementRequired) return true;
  return state.signatureConfigured;
}

/**
 * Why the builder's primary button cannot be pressed on the agreement step,
 * or null when it can. Mirrors `continueBlocker` in `builderJourney.ts`.
 */
export function agreementStepBlocker(choice: AgreementChoice, hasSignature: boolean): string | null {
  if (choice === null) return 'Choose whether this hostel uses a tenant agreement';
  if (choice === 'yes' && !hasSignature) return 'Draw your signature to continue';
  return null;
}

/**
 * The second question on the same step: is a parent/guardian's number chased
 * until it is verified, or simply recorded?
 *
 * It lives beside the agreement question rather than on a step of its own
 * because they are the same question in different clothes — *what does this
 * hostel demand of a tenant before they move in* — and a five-step builder
 * does not need a sixth screen to hold one toggle.
 *
 * Neither answer blocks a tenant from activating (see ADR-212); what the
 * owner is choosing is whether the product chases the gap afterwards.
 */
export type GuardianChoice = 'mandatory' | 'optional' | null;

/**
 * Why the builder's primary button cannot be pressed on this step, or null.
 *
 * The guardian question has no default answer on purpose, for the same reason
 * the agreement one does not: leaving it unset is not neutral. It would quietly
 * mean "chase every tenant's parent forever", which is a real decision about
 * how this hostel treats its residents, and it should be made rather than
 * inherited.
 */
export function onboardingRulesStepBlocker(
  agreementChoice: AgreementChoice,
  hasSignature: boolean,
  guardianChoice: GuardianChoice,
): string | null {
  const agreementBlocker = agreementStepBlocker(agreementChoice, hasSignature);
  if (agreementBlocker) return agreementBlocker;
  if (guardianChoice === null) return 'Choose how guardian numbers are verified';
  return null;
}

/**
 * Whether this hostel's guardian question has been answered at all.
 *
 * Unlike `isAgreementSettled`, an untouched default *does* count as settled
 * here — MANDATORY is what every hostel got before the setting existed, so a
 * hostel that already has tenants is not in an ambiguous state, it is in the
 * strict one. Only a brand-new build is asked.
 */
export function guardianChoiceFromPolicy(stored: unknown): GuardianChoice {
  if (stored === undefined || stored === null) return null;
  return String(stored).toUpperCase() === 'OPTIONAL' ? 'optional' : 'mandatory';
}

/** The API value for a chosen option. */
export function guardianPolicyValue(choice: Exclude<GuardianChoice, null>): 'MANDATORY' | 'OPTIONAL' {
  return choice === 'optional' ? 'OPTIONAL' : 'MANDATORY';
}
