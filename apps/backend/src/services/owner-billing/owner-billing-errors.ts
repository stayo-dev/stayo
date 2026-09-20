/** Same shape as `subscription-errors.ts`'s `SubscriptionError` — a distinct
 * class (not reused) because generic owner-payment errors are a different
 * domain and must never be caught by `isSubscriptionError`/`subscriptionErrorResponse`,
 * which would misroute an owner-payment 404/409 through subscription-specific logging. */
export class OwnerBillingError extends Error {
  code: string;
  status: number;
  details?: any;

  constructor(message: string, code = "OWNER_BILLING_ERROR", status = 400, details?: any) {
    super(message);
    this.name = "OwnerBillingError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function isOwnerBillingError(error: unknown): error is OwnerBillingError {
  return error instanceof OwnerBillingError;
}
