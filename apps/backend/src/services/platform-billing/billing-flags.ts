/**
 * Feature gate for owner-subscription enforcement (ADR-172, Phase 3).
 *
 * `PLATFORM_BILLING_ENFORCED=true` turns the hard blocks ON:
 *   - `requireActiveSubscription` returns 402 for a non-active owner
 *   - `planCapacityService.assertCanActivate` returns 409 at the plan ceiling
 *
 * Default (unset / anything else) = WARN-ONLY: the guards run, log what they
 * would have blocked (`SUBSCRIPTION_ENFORCEMENT_SKIPPED`), and allow the action.
 * This is the ramp — enforcement must not be switched on in production until
 * every legitimate existing owner has a backfilled `ACTIVE` subscription (a
 * separate data migration, not part of this phase).
 */
export function isBillingEnforced(): boolean {
  return String(process.env.PLATFORM_BILLING_ENFORCED || "").toLowerCase() === "true";
}
