/** Typed error for the owner subscription billing domain (ADR-172). */
export class SubscriptionError extends Error {
  code: string;
  status: number;
  details?: Record<string, unknown>;
  constructor(message: string, code = "SUBSCRIPTION_ERROR", status = 400, details?: Record<string, unknown>) {
    super(message);
    this.name = "SubscriptionError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function isSubscriptionError(e: unknown): e is SubscriptionError {
  return e instanceof SubscriptionError || (typeof e === "object" && e !== null && (e as any).name === "SubscriptionError");
}
