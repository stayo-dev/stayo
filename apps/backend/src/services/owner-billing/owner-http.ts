/**
 * Small HTTP helpers for the generic owner-payment routes — the same shape as
 * `platform-billing/subscription-http.ts`'s `subscriptionErrorResponse`, kept
 * as a separate function (not reused) so an `OwnerBillingError` is mapped and
 * logged under its own context, distinct from subscription-billing errors.
 * `resolveOwnerId` / `HttpForbidden` themselves ARE reused directly from
 * `subscription-http.ts` — already the shared "resolve the session's own
 * owner id" helper used by several non-subscription owner routes.
 */
import { apiError } from "@/lib/auth";
import { HttpForbidden } from "@/src/services/platform-billing/subscription-http";
import { isOwnerBillingError } from "./owner-billing-errors";

export { resolveOwnerId, HttpForbidden } from "@/src/services/platform-billing/subscription-http";

export function ownerBillingErrorResponse(error: unknown, context: string) {
  if (error instanceof HttpForbidden) return apiError(error.message, "FORBIDDEN", 403);
  if (isOwnerBillingError(error)) {
    const e = error as any;
    return apiError(e.message, e.code || "OWNER_BILLING_ERROR", e.status || 400, e.details);
  }
  console.error(`Detailed API Error [${context}]:`, error);
  return apiError("Something went wrong with that request.", "INTERNAL_ERROR", 500);
}
