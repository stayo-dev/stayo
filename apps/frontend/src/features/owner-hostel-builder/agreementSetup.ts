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
