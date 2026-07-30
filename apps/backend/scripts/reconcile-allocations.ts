import { prisma } from "../lib/db";
import { allocationReconciliationService } from "../lib/services/allocation-reconciliation-service";

async function main() {
  const startedAt = Date.now();
  const now = new Date();
  console.log("[reconcile-allocations] starting", { now: now.toISOString() });

  const inviteExpiry = await allocationReconciliationService.expireStaleInvitations(now);
  console.log("[reconcile-allocations] invitation-expiry", inviteExpiry);

  const activeAllocations = await prisma.roomAllocation.findMany({
    where: { is_active: true, end_date: null },
    select: { id: true },
    orderBy: { created_at: "asc" },
  });

  let reconciled = 0;
  let failed = 0;
  for (const a of activeAllocations) {
    try {
      await allocationReconciliationService.reconcileAllocation(a.id);
      reconciled++;
    } catch (err: any) {
      failed++;
      console.error("[reconcile-allocations] reconcile-failed", {
        allocation_id: a.id,
        error: String(err?.message || err),
      });
    }
  }

  const durationMs = Date.now() - startedAt;
  const summary = {
    scanned: activeAllocations.length,
    reconciled,
    failed,
    expired_invitations: inviteExpiry.expired_count,
    duration_ms: durationMs,
  };
  console.log("[reconcile-allocations] complete", summary);
}

main()
  .catch((err) => {
    console.error("[reconcile-allocations] fatal", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
