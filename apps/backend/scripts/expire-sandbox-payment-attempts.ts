/**
 * Immediately expire all CREATED/PENDING attempts that were generated
 * under sandbox mode (checkout_url points to mercury-t2 or api-preprod).
 *
 * Run: npx tsx scripts/expire-sandbox-payment-attempts.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const SANDBOX_URL_MARKERS = ["mercury-t2", "api-preprod", "pg-sandbox"];

function isSandboxCheckoutUrl(url: string | null): boolean {
  if (!url) return false;
  return SANDBOX_URL_MARKERS.some((marker) => url.includes(marker));
}

async function main() {
  console.log("[expire-sandbox-attempts] Scanning CREATED/PENDING attempts for sandbox URLs...");

  const candidates = await prisma.paymentAttempt.findMany({
    where: {
      status: { in: ["CREATED", "PENDING"] },
    },
    select: {
      id: true,
      status: true,
      checkout_url: true,
      created_at: true,
      merchant_txn_id: true,
    },
  });

  console.log(`[expire-sandbox-attempts] Found ${candidates.length} CREATED/PENDING attempt(s)`);

  const sandboxAttempts = candidates.filter((a) => isSandboxCheckoutUrl(a.checkout_url));
  const unknownUrlAttempts = candidates.filter((a) => !a.checkout_url && a.status === "PENDING");

  console.log(`[expire-sandbox-attempts] Sandbox checkout URLs detected: ${sandboxAttempts.length}`);
  console.log(`[expire-sandbox-attempts] PENDING with no checkout_url (suspicious): ${unknownUrlAttempts.length}`);

  if (sandboxAttempts.length === 0 && unknownUrlAttempts.length === 0) {
    console.log("[expire-sandbox-attempts] Nothing to expire. All attempts look clean.");
    return;
  }

  const toExpireIds = [
    ...sandboxAttempts.map((a) => a.id),
    ...unknownUrlAttempts.map((a) => a.id),
  ];

  console.log("[expire-sandbox-attempts] Expiring:", toExpireIds);

  const result = await prisma.paymentAttempt.updateMany({
    where: { id: { in: toExpireIds } },
    data: { status: "EXPIRED" },
  });

  console.log(`[expire-sandbox-attempts] ✅ Expired ${result.count} stale sandbox attempt(s).`);
  console.log("[expire-sandbox-attempts] Done. Next create-intent call will generate a fresh production checkout.");
}

main()
  .catch((e) => { console.error("[expire-sandbox-attempts] Fatal:", e); process.exit(1); })
  .finally(() => prisma.$disconnect());
