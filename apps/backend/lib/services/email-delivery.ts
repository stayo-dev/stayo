/**
 * Email delivery configuration reporting.
 *
 * Pure and I/O-free on purpose: the password-reset endpoint has to answer
 * "can this deployment actually deliver mail?" **without** reference to the
 * recipient. Anything recipient-dependent leaks whether an account exists,
 * which would defeat the generic "if an account exists for this email…"
 * response the endpoint deliberately returns.
 *
 * Background: before this existed, `requestPasswordReset` swallowed provider
 * failures and returned the success message anyway, so a complete delivery
 * outage looked exactly like a healthy one.
 */

/** Resend's sandbox sender works without domain verification, but only delivers to the Resend account owner's own address. */
export function isSandboxSender(from: string): boolean {
  return /@resend\.dev\s*>?\s*$/i.test(String(from || "").trim());
}

export type EmailDeliveryDegradation = "PROVIDER_NOT_CONFIGURED" | "SANDBOX_SENDER";

export interface EmailDeliveryConfigReport {
  degraded: boolean;
  reason: EmailDeliveryDegradation | null;
}

export function describeEmailDeliveryConfig(input: {
  apiKey?: string | null;
  from?: string | null;
}): EmailDeliveryConfigReport {
  if (!String(input.apiKey || "").trim()) {
    return { degraded: true, reason: "PROVIDER_NOT_CONFIGURED" };
  }
  if (isSandboxSender(String(input.from || ""))) {
    return { degraded: true, reason: "SANDBOX_SENDER" };
  }
  return { degraded: false, reason: null };
}
