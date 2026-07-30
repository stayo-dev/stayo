import { prisma } from "../lib/db";
import { paymentService } from "../src/services/payments/payment-service";

async function main() {
  const startedAt = Date.now();
  const now = new Date();
  console.log("[reconcile-payments] starting reconciliation sweep", { now: now.toISOString() });

  const result = await paymentService.reconcilePendingAttempts();
  
  const durationMs = Date.now() - startedAt;
  console.log("[reconcile-payments] reconciliation complete", {
    ...result,
    duration_ms: durationMs,
  });
}

main()
  .catch((err) => {
    console.error("[reconcile-payments] fatal error during reconciliation", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
