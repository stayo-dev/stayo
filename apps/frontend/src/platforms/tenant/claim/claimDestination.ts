/**
 * Where a tenant lands once their claim succeeds.
 *
 * Claiming links an account to a tenancy the owner has been keeping records
 * for. It proves who they are and it settles what they owe — but it collects
 * none of what every self-serve tenant provides on the way in: identity
 * details, ID documents, guardian contacts, and a signed residency agreement.
 * Sending a freshly-claimed tenant to the dashboard banked the account and
 * quietly skipped all of it.
 *
 * So a tenant who still owes onboarding goes to `/activate` instead, and
 * arrives there on their session rather than a token — their invitation was
 * superseded at adoption and its link is dead by design. See ADR-155.
 *
 * The signed-in check is not a formality: without a session there is no
 * credential for `/activate` to resolve, so that case must go to login and
 * pick onboarding up afterwards.
 */

export interface ClaimDestinationInput {
  /** `activation_required` from the claim confirm result. */
  activationRequired?: boolean | null;
  /** Whether the tenant actually holds a session now. */
  signedIn: boolean;
}

export const CLAIM_DESTINATION_LOGIN = '/login?signin=1';
export const CLAIM_DESTINATION_ONBOARDING = '/activate';
export const CLAIM_DESTINATION_HOME = '/tenant/home';

export function claimDestination(input: ClaimDestinationInput): string {
  if (!input?.signedIn) return CLAIM_DESTINATION_LOGIN;
  return input.activationRequired ? CLAIM_DESTINATION_ONBOARDING : CLAIM_DESTINATION_HOME;
}
