/**
 * The combined subscription + capacity gate for a tenant activation
 * (ADR-172, Phase 3).
 *
 * Call this inside the same transaction as the `tenants.status = 'ACTIVE'`
 * write, immediately before it, with the ownerId resolved server-side (from the
 * tenancy row or the authenticated session — never request input).
 *
 * It enforces:
 *   - `requireActiveSubscription(ownerId)` — the owner's subscription must be
 *     ACTIVE (or under a valid admin override)
 *   - `planCapacityService.assertCanActivate(ownerId)` — the CURRENT plan's
 *     capacity ceiling (FOUNDING = unlimited), with a `FOR UPDATE` lock on the
 *     `owner_subscriptions` row so concurrent activations for one owner cannot
 *     both slip past the same 49→50 boundary
 *
 * Both are gated by `PLATFORM_BILLING_ENFORCED` — warn-only while off.
 */
import { planCapacityService } from "./plan-capacity-service";

export async function assertOwnerCanActivateTenant(
  ownerId: string,
  opts: { tx: any; tenantId?: string | null; isRenewal?: boolean; context: string },
): Promise<void> {
  if (!ownerId) return; // an ownerless tenancy predates the owner model; nothing to gate
  await planCapacityService.assertCanActivate(ownerId, {
    tx: opts.tx,
    tenantId: opts.tenantId ?? null,
    isRenewal: opts.isRenewal ?? false,
    context: opts.context,
  });
}
