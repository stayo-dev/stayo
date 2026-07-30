/**
 * P0 Reconciliation: Supersede duplicate RENT obligations.
 *
 * Logic:
 *   1. Find all (tenant_id, rent_month) pairs with >1 active RENT obligation
 *   2. For each duplicate group, keep the CANONICAL obligation:
 *      - Prefer agreement_id IS NOT NULL (agreement-linked = canonical)
 *      - If both have agreement_id, keep the one created later (schedule takes precedence)
 *      - If neither has agreement_id, keep the one created first
 *   3. Mark orphans as is_superseded = true (NO deletes)
 *   4. ABORT if any orphan has payments/receipts — print report instead
 *
 * Usage:
 *   DOTENV_CONFIG_PATH=.env npx tsx -r dotenv/config scripts/reconcile-duplicate-rent.ts
 *   DOTENV_CONFIG_PATH=.env npx tsx -r dotenv/config scripts/reconcile-duplicate-rent.ts --dry-run
 */
import { prisma } from "../lib/db";

const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  P0 RECONCILIATION: Duplicate RENT Obligation Cleanup");
  console.log(`  Mode: ${DRY_RUN ? "DRY RUN (no writes)" : "⚠️  LIVE — will supersede duplicates"}`);
  console.log("═══════════════════════════════════════════════════════════════\n");

  // Step 1: Find all duplicate groups
  const duplicateGroups = await prisma.$queryRaw<any[]>`
    SELECT
      tenant_id,
      rent_month,
      obligation_type,
      COUNT(*) as cnt
    FROM rent_obligations
    WHERE is_superseded = false
      AND obligation_type = 'RENT'
    GROUP BY tenant_id, rent_month, obligation_type
    HAVING COUNT(*) > 1
    ORDER BY rent_month DESC
  `;

  if (duplicateGroups.length === 0) {
    console.log("✅ No duplicate RENT obligations found. Nothing to reconcile.\n");
    await prisma.$disconnect();
    return;
  }

  console.log(`Found ${duplicateGroups.length} duplicate group(s):\n`);

  let totalSuperseded = 0;
  let totalBlocked = 0;
  const blockedReports: string[] = [];

  for (const group of duplicateGroups) {
    const tenant = await prisma.tenants.findUnique({
      where: { id: group.tenant_id },
      include: { profiles: { select: { name: true } } },
    });
    const tenantName = tenant?.profiles?.name || "Unknown";
    const monthLabel = new Date(group.rent_month).toISOString().slice(0, 7);

    console.log(`─── ${tenantName} | ${monthLabel} | ${group.cnt} obligations ───`);

    // Fetch all obligations in this duplicate group
    const obligations = await prisma.rent_obligations.findMany({
      where: {
        tenant_id: group.tenant_id,
        rent_month: group.rent_month,
        obligation_type: "RENT",
        is_superseded: false,
      },
      include: {
        payments: { select: { id: true, amount_paid: true } },
      },
      orderBy: { created_at: "asc" },
    });

    // Determine canonical obligation (the one to KEEP)
    // Priority: agreement_id IS NOT NULL > allocation_id IS NOT NULL > created_at DESC
    let canonical = obligations[0];
    for (const ob of obligations) {
      if (ob.agreement_id && !canonical.agreement_id) {
        canonical = ob;
      } else if (ob.agreement_id && canonical.agreement_id && ob.created_at > canonical.created_at) {
        canonical = ob;
      } else if (ob.allocation_id && !canonical.allocation_id && !canonical.agreement_id) {
        canonical = ob;
      }
    }

    const orphans = obligations.filter((ob) => ob.id !== canonical.id);

    console.log(`  KEEP (canonical): ${canonical.id}`);
    console.log(`    agreement_id: ${canonical.agreement_id || "NULL"}`);
    console.log(`    allocation_id: ${canonical.allocation_id || "NULL"}`);
    console.log(`    label: "${canonical.installment_label}"`);
    console.log(`    due_date: ${canonical.due_date}`);
    console.log(`    payments: ${canonical.payments.length}`);

    for (const orphan of orphans) {
      const hasPayments = orphan.payments.length > 0;
      const totalPaid = orphan.payments.reduce((sum: number, p: any) => sum + Number(p.amount_paid), 0);

      console.log(`  SUPERSEDE: ${orphan.id}`);
      console.log(`    agreement_id: ${orphan.agreement_id || "NULL"}`);
      console.log(`    allocation_id: ${orphan.allocation_id || "NULL"}`);
      console.log(`    label: "${orphan.installment_label}"`);
      console.log(`    due_date: ${orphan.due_date}`);
      console.log(`    payments: ${orphan.payments.length} (₹${totalPaid})`);

      if (hasPayments) {
        console.log(`    ⛔ BLOCKED — has ${orphan.payments.length} payment(s) totaling ₹${totalPaid}`);
        console.log(`    → Manual review required. Cannot auto-supersede obligations with payments.`);
        totalBlocked++;
        blockedReports.push(
          `  ${tenantName} | ${monthLabel} | obligation=${orphan.id} | payments=${orphan.payments.length} | paid=₹${totalPaid}`
        );
        continue;
      }

      if (!DRY_RUN) {
        await prisma.rent_obligations.update({
          where: { id: orphan.id },
          data: {
            is_superseded: true,
            superseded_at: new Date(),
            updated_at: new Date(),
          },
        });
        console.log(`    ✅ Superseded`);
      } else {
        console.log(`    🔍 Would supersede (dry run)`);
      }
      totalSuperseded++;
    }
    console.log();
  }

  // Summary
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  RECONCILIATION SUMMARY");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log(`  Duplicate groups found: ${duplicateGroups.length}`);
  console.log(`  Obligations ${DRY_RUN ? "to supersede" : "superseded"}: ${totalSuperseded}`);
  console.log(`  Blocked (has payments): ${totalBlocked}`);

  if (blockedReports.length > 0) {
    console.log(`\n  ⛔ BLOCKED OBLIGATIONS (manual review required):`);
    for (const r of blockedReports) console.log(r);
  }

  if (DRY_RUN) {
    console.log(`\n  To apply changes, run without --dry-run`);
  }

  console.log();
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
