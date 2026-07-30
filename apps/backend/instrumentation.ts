/**
 * Next.js Instrumentation Hook
 *
 * Runs once on server startup. Used for boot-time security assertions
 * and system integrity checks.
 *
 * @see https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */

// Guarantee correction handlers are registered at server startup
import "./src/services/recovery/bootstrap";

export async function register() {
  // Only run security checks on the Node.js server, not on Edge runtime
  if (process.env.NEXT_RUNTIME === "nodejs") {
    try {
      const { assertOwnerIntegrity } = await import("./lib/security/owner-integrity-guard");
      await assertOwnerIntegrity();
    } catch (err: any) {
      console.error("[instrumentation] Owner integrity check failed:", err?.message || err);
    }
    try {
      const { validatePaymentEnvironment } = await import("./src/services/payments/payment-env");
      validatePaymentEnvironment();
    } catch (err: any) {
      console.error("[instrumentation] Payment provider integrity check failed:", err?.message || err);
      // Hard crash the server in production when payment settings are invalid
      if (process.env.NODE_ENV === "production") {
        process.exit(1);
      }
    }
  }
}
