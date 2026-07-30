import { rentGenerationService } from "../services/rent-generation-service";
import { paymentService } from "../services/payment-service";
import { prisma } from "../db";
import { PAYMENT_DOMAIN } from "../services/payments/financial-domain";

/**
 * Strategy for Background Jobs in Next.js (Serverless):
 * 1. For Cron jobs: Use Vercel Cron Jobs (matching /api/cron/* routes).
 * 2. For instant background tasks: Use an external queue like Upstash QStash or Vercel KV.
 * 3. For long-running tasks: Use a dedicated worker or AWS Lambda.
 */

export async function dailyReconciliation() {
  console.log("[Job] Starting daily reconciliation...");
  const platform = await paymentService.reconcilePendingAttempts({
    paymentDomain: PAYMENT_DOMAIN.PLATFORM_BILLING,
  });
  const hostels = await prisma.hostels.findMany({
    where: { status: { in: ["ACTIVE", "INACTIVE"] } },
    select: { id: true, owner_id: true },
  });
  let processed = platform.processed || 0;
  for (const hostel of hostels) {
    const result = await paymentService.reconcilePendingAttempts({
      ownerId: hostel.owner_id,
      hostelId: hostel.id,
      paymentDomain: PAYMENT_DOMAIN.RENT_COLLECTION,
    });
    processed += result.processed || 0;
  }
  console.log(`[Job] Reconciliation finished: ${processed} processed across platform + ${hostels.length} hostels.`);
}

export async function monthlyRentGeneration() {
  console.log("[Job] Starting monthly rent generation...");
  const hostels = await prisma.hostels.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, owner_id: true },
  });

  let created = 0;
  let skipped = 0;
  let locked = 0;
  for (const hostel of hostels) {
    const result = await rentGenerationService.generateMonthlyRent(undefined, hostel.owner_id, "cron", hostel.id);
    if ("locked" in result) {
      locked++;
      console.warn(`[Job] Rent generation skipped for hostel ${hostel.id}: ${result.error}`);
    } else {
      created += result.created;
      skipped += result.skipped;
    }
  }
  console.log(`[Job] Rent generation finished: ${created} created, ${skipped} skipped, ${locked} locked.`);
}
