/**
 * Small HTTP helpers shared by the owner + admin subscription routes
 * (ADR-172, Phase 2). Keeps authorization and error mapping in one place.
 */
import { apiError } from "@/lib/auth";
import { isSubscriptionError, SubscriptionError } from "./subscription-errors";
import { requireActiveSubscription } from "./subscription-access-service";
import { isBillingEnforced } from "./billing-flags";

/** The owner's own `profiles.id`. Never read from request input. */
export function resolveOwnerId(session: any): string {
  if (!session || session.role !== "OWNER") {
    throw new HttpForbidden("Owner access only.");
  }
  // For owners, `sub` is the profile id; `owner_id` self-heals to the same
  // value (see lib/auth/supabase-session). `sub` is the canonical choice —
  // it matches every other owner-scoped route (e.g. /api/owner/payout-account).
  return session.sub as string;
}

export function requireAdmin(session: any): void {
  if (!session || session.role !== "ADMIN") {
    throw new HttpForbidden("Admin access only.");
  }
}

export class HttpForbidden extends Error {
  constructor(message = "Forbidden") {
    super(message);
    this.name = "HttpForbidden";
  }
}

/**
 * Gate an owner platform-management MUTATION on an active subscription
 * (ADR-172, Phase 3 correction).
 *
 * Call it at the top of the mutating handler with the ownerId already resolved
 * server-side (`resolveOwnerScope(session).owner_id`, or `session.sub` for an
 * OWNER session) — never a body/query value.
 *
 *   ACTIVE (or a valid admin override) → returns
 *   PENDING_PAYMENT / PAUSED / EXPIRED / legacy TRIAL / CANCELLED / missing
 *     → throws `SubscriptionError('SUBSCRIPTION_INACTIVE', 402)` when
 *       `PLATFORM_BILLING_ENFORCED=true`, otherwise logs and returns (warn-only).
 *
 * Infra failures are swallowed while enforcement is off, so wiring this into a
 * route can never break it during the ramp.
 */
export async function assertOwnerSubscriptionActive(ownerId: string, context: string): Promise<void> {
  try {
    await requireActiveSubscription(ownerId, { context });
  } catch (e) {
    if (e instanceof SubscriptionError) throw e; // a real 402 block
    if (!isBillingEnforced()) {
      console.warn(`[billing] subscription check infra error (warn-only, ignored) [${context}]:`, e);
      return;
    }
    throw e;
  }
}

/** Map a thrown error to the repo's standard `apiError` response. */
export function subscriptionErrorResponse(error: unknown, context: string) {
  if (error instanceof HttpForbidden) return apiError(error.message, "FORBIDDEN", 403);
  if (isSubscriptionError(error)) {
    const e = error as any;
    return apiError(e.message, e.code || "SUBSCRIPTION_ERROR", e.status || 400, e.details);
  }
  console.error(`Detailed API Error [${context}]:`, error);
  return apiError("Something went wrong with that request.", "INTERNAL_ERROR", 500);
}

/**
 * For a *mixed* route's own generic catch block (ADR-172, Phase 6.3) — one of
 * the ~40 owner platform-management mutation routes, or a tenant-activation
 * route, that calls `assertOwnerSubscriptionActive` / reaches
 * `plan-capacity-service.assertCanActivate` several calls deep and otherwise
 * has its own error handling for everything else.
 *
 * Drop this at the very top of that existing `catch (error) { ... }`:
 *
 *   const billing = billingErrorResponse(error);
 *   if (billing) return billing;
 *   // ...the route's own handling, unchanged, for every other error...
 *
 * Returns the correctly-mapped response (402 `SUBSCRIPTION_INACTIVE`, 409
 * `SUBSCRIPTION_CAPACITY_REACHED`, etc. — whatever the thrown
 * `SubscriptionError` carries) for a billing error, or `null` for anything
 * else, so a route's own handling of its own errors is untouched. Without
 * this, these routes' generic catches read only `error.message` and default
 * to HTTP 500 — turning an intended 402/409 into a wrong, unhelpful 500 the
 * moment `PLATFORM_BILLING_ENFORCED` is turned on.
 */
export function billingErrorResponse(error: unknown) {
  if (!isSubscriptionError(error)) return null;
  const e = error as any;
  return apiError(e.message, e.code || "SUBSCRIPTION_ERROR", e.status || 400, e.details);
}
