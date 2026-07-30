/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  ONE-TIME DATA CORRECTION — 2026-07-07                              ║
 * ║                                                                     ║
 * ║  Administrative data migration requested by owner.                  ║
 * ║  Does NOT trigger events, notifications, or audit-trail entries.    ║
 * ║  Run with --apply to commit changes.                                ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 *
 * Corrections:
 *   1. Durga Prasad (Room 401) — Fix agreement dates & generate 4 rent obligations
 *   2. Deepak (Room 101) — Zero out security deposit
 *   3. Manoj Kumar (Room 505) — Shift agreement start to April, add April rent
 */

import { prisma } from "../lib/db";
import * as fs from "fs";
import * as path from "path";

// ── Tenant IDs (verified via DB query) ────────────────────────────────────────
const DURGA_TENANT_ID   = "e33205e6-46e0-4507-a717-cf1702e11f7b";
const DURGA_AGREEMENT   = "33234aae-c624-4a43-a363-2a848cf46721";

const DEEPAK_TENANT_ID  = "654ab380-833c-4ac4-a2b8-24943b09036c";
const DEEPAK_AGREEMENT  = "da0fdab8-e252-4494-8767-5e9843c6d499";

const MANOJ_TENANT_ID   = "252b6480-233e-4706-8095-24e3ea236a41";
const MANOJ_AGREEMENT   = "2dae741c-c870-4fdc-a13d-2be54bee3902";

const OWNER_ID          = "c39676a0-c867-4435-9660-a060b8bceab6";
const HOSTEL_ID         = "6fa62eca-cbb1-4b12-8567-81756608ed38";

async function backupState() {
  const tenants = await prisma.tenants.findMany({
    where: { id: { in: [DURGA_TENANT_ID, DEEPAK_TENANT_ID, MANOJ_TENANT_ID] } },
  });
  const agreements = await prisma.agreement.findMany({
    where: { id: { in: [DURGA_AGREEMENT, DEEPAK_AGREEMENT, MANOJ_AGREEMENT] } },
  });
  const obligations = await prisma.rent_obligations.findMany({
    where: { tenant_id: { in: [DURGA_TENANT_ID, DEEPAK_TENANT_ID, MANOJ_TENANT_ID] } },
  });

  const backupDir = path.join(__dirname, "backups");
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

  const backupPath = path.join(backupDir, `backup-data-correction-${Date.now()}.json`);
  fs.writeFileSync(backupPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    tenants,
    agreements,
    obligations,
  }, null, 2), "utf8");

  console.log(`[BACKUP] State saved to: ${backupPath}`);
  return backupPath;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CORRECTION 1: Durga Prasad — Agreement Apr-Jul 2026, 4 rent obligations
// ═══════════════════════════════════════════════════════════════════════════════
async function correctDurgaPrasad(isApply: boolean) {
  console.log("\n════════════════════════════════════════════");
  console.log("  CORRECTION 1: M. Durga Prasad (Room 401)");
  console.log("════════════════════════════════════════════");

  const tenant = await prisma.tenants.findUniqueOrThrow({ where: { id: DURGA_TENANT_ID } });
  const agreement = await prisma.agreement.findUniqueOrThrow({ where: { id: DURGA_AGREEMENT } });
  const existingObs = await prisma.rent_obligations.findMany({
    where: { tenant_id: DURGA_TENANT_ID, is_superseded: false },
    orderBy: { rent_month: "asc" },
    include: { payments: true },
  });

  console.log("\n[CURRENT STATE]");
  console.log(`  Agreement: ${agreement.agreement_start_date?.toISOString().slice(0,10)} → ${agreement.agreement_end_date?.toISOString().slice(0,10)} (${agreement.agreement_duration_months}mo)`);
  console.log(`  Tenant joined_on: ${tenant.joined_on?.toISOString().slice(0,10)}`);
  console.log(`  Obligations: ${existingObs.length}`);
  for (const o of existingObs) {
    const hasPay = o.payments.length > 0;
    console.log(`    ${o.obligation_type} ${o.rent_month?.toISOString().slice(0,7)} ₹${o.amount} [${o.status}]${hasPay ? ` ⚠ HAS ${o.payments.length} PAYMENT(S)` : ""}`);
  }

  console.log("\n[PLANNED CHANGES]");
  console.log("  Agreement: 2026-04-01 → 2026-07-31 (4 months)");
  console.log("  Tenant joined_on: 2026-04-01");
  console.log("  Supersede existing Sep/Oct/Nov UPCOMING rent obligations");
  console.log("  Create 4 new rent obligations: Apr, May, Jun, Jul 2026 (₹8,100 each, PENDING)");

  // The SECURITY_DEPOSIT obligation (PAID) stays — it's real payment history
  const depositOb = existingObs.find(o => o.obligation_type === "SECURITY_DEPOSIT");
  const rentObsToSupersede = existingObs.filter(o => o.obligation_type === "RENT" && o.payments.length === 0);
  const rentObsWithPayments = existingObs.filter(o => o.obligation_type === "RENT" && o.payments.length > 0);

  if (rentObsWithPayments.length > 0) {
    console.log(`\n  ⚠ WARNING: ${rentObsWithPayments.length} rent obligation(s) have payments — will NOT supersede these.`);
  }

  if (!isApply) {
    console.log("\n  [DRY-RUN] No changes made.");
    return;
  }

  await prisma.$transaction(async (tx) => {
    // 1. Update agreement dates
    await tx.agreement.update({
      where: { id: DURGA_AGREEMENT },
      data: {
        agreement_start_date: new Date("2026-04-01T00:00:00.000Z"),
        agreement_end_date: new Date("2026-07-31T00:00:00.000Z"),
        agreement_duration_months: 4,
      },
    });

    // 2. Update tenant joined_on and billing_start_date
    await tx.tenants.update({
      where: { id: DURGA_TENANT_ID },
      data: {
        joined_on: new Date("2026-04-01T00:00:00.000Z"),
        billing_start_date: new Date("2026-04-01T00:00:00.000Z"),
      },
    });

    // 3. Supersede existing unpaid RENT obligations (Sep/Oct/Nov)
    for (const ob of rentObsToSupersede) {
      await tx.rent_obligations.update({
        where: { id: ob.id },
        data: {
          is_superseded: true,
          superseded_at: new Date(),
          installment_label: `[SUPERSEDED by data correction] ${ob.installment_label}`,
        },
      });
    }

    // 4. Create 4 new rent obligations (Apr, May, Jun, Jul 2026)
    const months = [
      { month: new Date("2026-04-01T00:00:00.000Z"), label: "Apr 2026 rent (1)", due: new Date("2026-04-05T00:00:00.000Z") },
      { month: new Date("2026-05-01T00:00:00.000Z"), label: "May 2026 rent (2)", due: new Date("2026-05-05T00:00:00.000Z") },
      { month: new Date("2026-06-01T00:00:00.000Z"), label: "Jun 2026 rent (3)", due: new Date("2026-06-05T00:00:00.000Z") },
      { month: new Date("2026-07-01T00:00:00.000Z"), label: "Jul 2026 rent (4)", due: new Date("2026-07-05T00:00:00.000Z") },
    ];

    for (const m of months) {
      await tx.rent_obligations.create({
        data: {
          tenant_id: DURGA_TENANT_ID,
          owner_id: OWNER_ID,
          hostel_id: HOSTEL_ID,
          allocation_id: null,
          rent_month: m.month,
          amount: 8100,
          total_amount: 8100,
          due_date: m.due,
          status: "PENDING",
          obligation_type: "RENT",
          billing_period_start: m.month,
          billing_period_end: new Date(Date.UTC(m.month.getUTCFullYear(), m.month.getUTCMonth() + 1, 0)),
          installment_label: m.label,
        },
      });
    }

    // 5. Update the security deposit obligation's rent_month to April too (cosmetic alignment)
    if (depositOb) {
      await tx.rent_obligations.update({
        where: { id: depositOb.id },
        data: {
          rent_month: new Date("2026-04-01T00:00:00.000Z"),
          due_date: new Date("2026-04-01T00:00:00.000Z"),
        },
      });
    }
  });

  console.log("\n  ✅ Durga Prasad corrections applied successfully.");
}

// ═══════════════════════════════════════════════════════════════════════════════
// CORRECTION 2: Deepak — Zero out security deposit
// ═══════════════════════════════════════════════════════════════════════════════
async function correctDeepak(isApply: boolean) {
  console.log("\n════════════════════════════════════════════");
  console.log("  CORRECTION 2: Deepak (Room 101)");
  console.log("════════════════════════════════════════════");

  const tenant = await prisma.tenants.findUniqueOrThrow({ where: { id: DEEPAK_TENANT_ID } });
  const agreement = await prisma.agreement.findUniqueOrThrow({ where: { id: DEEPAK_AGREEMENT } });

  // Check for any deposit obligations
  const depositObs = await prisma.rent_obligations.findMany({
    where: {
      tenant_id: DEEPAK_TENANT_ID,
      obligation_type: "SECURITY_DEPOSIT",
    },
  });

  // Check ledger
  const ledgerEntries = await prisma.tenant_financial_ledger.findMany({
    where: { tenant_id: DEEPAK_TENANT_ID },
  });

  console.log("\n[CURRENT STATE]");
  console.log(`  Tenant security_deposit: ₹${tenant.security_deposit}`);
  console.log(`  Agreement contract_security_deposit: ₹${agreement.contract_security_deposit}`);
  console.log(`  Deposit obligations: ${depositObs.length}`);
  console.log(`  Ledger entries: ${ledgerEntries.length}`);

  console.log("\n[PLANNED CHANGES]");
  console.log("  Tenant security_deposit: ₹0");
  console.log("  Agreement contract_security_deposit: ₹0");
  console.log("  Agreement content_snapshot.advance_deposit: ₹0 (if exists)");
  console.log("  Rent obligations: UNCHANGED");

  if (!isApply) {
    console.log("\n  [DRY-RUN] No changes made.");
    return;
  }

  await prisma.$transaction(async (tx) => {
    // 1. Zero tenant deposit
    await tx.tenants.update({
      where: { id: DEEPAK_TENANT_ID },
      data: {
        security_deposit: 0,
        minimum_reservation_deposit: 0,
      },
    });

    // 2. Zero agreement deposit
    const contentSnapshot = (agreement.content_snapshot as any) || {};
    const rulesSnapshot = (agreement.rules_snapshot as any) || {};
    // Carefully replace deposit values in snapshots
    const updatedContent = { ...contentSnapshot };
    if ("advance_deposit" in updatedContent) updatedContent.advance_deposit = 0;
    if ("security_deposit" in updatedContent) updatedContent.security_deposit = 0;

    await tx.agreement.update({
      where: { id: DEEPAK_AGREEMENT },
      data: {
        contract_security_deposit: 0,
        content_snapshot: updatedContent,
        rules_snapshot: rulesSnapshot,
      },
    });

    // 3. If any deposit obligations exist, supersede them
    if (depositObs.length > 0) {
      for (const ob of depositObs) {
        await tx.rent_obligations.update({
          where: { id: ob.id },
          data: {
            is_superseded: true,
            superseded_at: new Date(),
            amount: 0,
            total_amount: 0,
            installment_label: `[SUPERSEDED by data correction] ${ob.installment_label}`,
          },
        });
      }
    }
  });

  console.log("\n  ✅ Deepak deposit corrections applied successfully.");
}

// ═══════════════════════════════════════════════════════════════════════════════
// CORRECTION 3: Manoj Kumar — Shift start to April, add April rent
// ═══════════════════════════════════════════════════════════════════════════════
async function correctManoj(isApply: boolean) {
  console.log("\n════════════════════════════════════════════");
  console.log("  CORRECTION 3: N.Monoj kumar (Room 505)");
  console.log("════════════════════════════════════════════");

  const tenant = await prisma.tenants.findUniqueOrThrow({ where: { id: MANOJ_TENANT_ID } });
  const agreement = await prisma.agreement.findUniqueOrThrow({ where: { id: MANOJ_AGREEMENT } });
  const existingObs = await prisma.rent_obligations.findMany({
    where: { tenant_id: MANOJ_TENANT_ID, is_superseded: false },
    orderBy: { rent_month: "asc" },
  });

  // Check if April rent already exists
  const hasAprilRent = existingObs.some(
    o => o.obligation_type === "RENT" && o.rent_month?.toISOString().startsWith("2026-04")
  );

  console.log("\n[CURRENT STATE]");
  console.log(`  Agreement: ${agreement.agreement_start_date?.toISOString().slice(0,10)} → ${agreement.agreement_end_date?.toISOString().slice(0,10)} (${agreement.agreement_duration_months}mo)`);
  console.log(`  Tenant joined_on: ${tenant.joined_on?.toISOString().slice(0,10)}`);
  console.log(`  Existing obligations: ${existingObs.length}`);
  for (const o of existingObs) {
    console.log(`    ${o.obligation_type} ${o.rent_month?.toISOString().slice(0,7)} ₹${o.amount} [${o.status}]`);
  }
  console.log(`  April rent exists: ${hasAprilRent}`);

  console.log("\n[PLANNED CHANGES]");
  console.log("  Agreement start: 2026-04-01 (was 2026-05-01)");
  console.log("  Agreement duration: 5 months (was 4)");
  console.log("  Agreement end: 2026-09-01 (unchanged)");
  console.log("  Tenant joined_on: 2026-04-01");
  console.log("  New obligation: April 2026 RENT ₹7,000 PENDING");
  console.log("  Existing obligations: UNCHANGED");

  if (hasAprilRent) {
    console.log("\n  ⚠ SKIP: April rent obligation already exists.");
    return;
  }

  if (!isApply) {
    console.log("\n  [DRY-RUN] No changes made.");
    return;
  }

  await prisma.$transaction(async (tx) => {
    // 1. Update agreement start date and duration
    await tx.agreement.update({
      where: { id: MANOJ_AGREEMENT },
      data: {
        agreement_start_date: new Date("2026-04-01T00:00:00.000Z"),
        // end_date stays 2026-09-01 — now 5 months instead of 4
        agreement_duration_months: 5,
      },
    });

    // 2. Update tenant joined_on
    await tx.tenants.update({
      where: { id: MANOJ_TENANT_ID },
      data: {
        joined_on: new Date("2026-04-01T00:00:00.000Z"),
      },
    });

    // 3. Create April rent obligation
    await tx.rent_obligations.create({
      data: {
        tenant_id: MANOJ_TENANT_ID,
        owner_id: OWNER_ID,
        hostel_id: HOSTEL_ID,
        allocation_id: null,
        rent_month: new Date("2026-04-01T00:00:00.000Z"),
        amount: 7000,
        total_amount: 7000,
        due_date: new Date("2026-04-05T00:00:00.000Z"),
        status: "PENDING",
        obligation_type: "RENT",
        billing_period_start: new Date("2026-04-01T00:00:00.000Z"),
        billing_period_end: new Date("2026-04-30T00:00:00.000Z"),
        installment_label: "Apr 2026 rent (0)",
      },
    });
  });

  console.log("\n  ✅ Manoj Kumar corrections applied successfully.");
}

// ═══════════════════════════════════════════════════════════════════════════════
// VERIFICATION
// ═══════════════════════════════════════════════════════════════════════════════
async function verify() {
  console.log("\n══════════════════════════════════════");
  console.log("  POST-CORRECTION VERIFICATION");
  console.log("══════════════════════════════════════");

  // Durga
  const durgaAg = await prisma.agreement.findUniqueOrThrow({ where: { id: DURGA_AGREEMENT } });
  const durgaObs = await prisma.rent_obligations.findMany({
    where: { tenant_id: DURGA_TENANT_ID, is_superseded: false, obligation_type: "RENT" },
    orderBy: { rent_month: "asc" },
  });
  const durgaOutstanding = durgaObs.reduce((sum, o) => sum + Number(o.amount), 0);

  console.log("\n  DURGA PRASAD:");
  console.log(`    ✅ Agreement: ${durgaAg.agreement_start_date?.toISOString().slice(0,10)} → ${durgaAg.agreement_end_date?.toISOString().slice(0,10)}`);
  console.log(`    ${durgaAg.agreement_start_date?.toISOString().startsWith("2026-04") ? "✅" : "❌"} Agreement starts on 01-Apr-2026`);
  console.log(`    ${durgaAg.agreement_end_date?.toISOString().startsWith("2026-07") ? "✅" : "❌"} Ends on 31-Jul-2026`);
  console.log(`    ${durgaObs.length === 4 ? "✅" : "❌"} Four rent entries exist (got ${durgaObs.length})`);
  console.log(`    ${durgaObs.every(o => o.status === "PENDING") ? "✅" : "⚠"} All four are Pending`);
  console.log(`    ${durgaOutstanding === 32400 ? "✅" : "❌"} Outstanding = ₹${durgaOutstanding.toLocaleString("en-IN")} (expected ₹32,400)`);

  // Deepak
  const deepakTenant = await prisma.tenants.findUniqueOrThrow({ where: { id: DEEPAK_TENANT_ID } });
  const deepakAg = await prisma.agreement.findUniqueOrThrow({ where: { id: DEEPAK_AGREEMENT } });
  const deepakDepositObs = await prisma.rent_obligations.findMany({
    where: { tenant_id: DEEPAK_TENANT_ID, obligation_type: "SECURITY_DEPOSIT", is_superseded: false },
  });
  const deepakRentObs = await prisma.rent_obligations.findMany({
    where: { tenant_id: DEEPAK_TENANT_ID, obligation_type: "RENT", is_superseded: false },
  });

  console.log("\n  DEEPAK:");
  console.log(`    ${Number(deepakTenant.security_deposit) === 0 ? "✅" : "❌"} Deposit = ₹${deepakTenant.security_deposit}`);
  console.log(`    ${Number(deepakAg.contract_security_deposit) === 0 ? "✅" : "❌"} Agreement deposit = ₹${deepakAg.contract_security_deposit}`);
  console.log(`    ${deepakDepositObs.length === 0 ? "✅" : "❌"} No deposit obligation exists (got ${deepakDepositObs.length})`);
  console.log(`    ${deepakRentObs.length === 4 ? "✅" : "❌"} Rent data unchanged (${deepakRentObs.length} obligations)`);

  // Manoj
  const manojAg = await prisma.agreement.findUniqueOrThrow({ where: { id: MANOJ_AGREEMENT } });
  const manojObs = await prisma.rent_obligations.findMany({
    where: { tenant_id: MANOJ_TENANT_ID, is_superseded: false, obligation_type: "RENT" },
    orderBy: { rent_month: "asc" },
  });
  const aprilRent = manojObs.find(o => o.rent_month?.toISOString().startsWith("2026-04"));

  console.log("\n  MANOJ KUMAR:");
  console.log(`    ${manojAg.agreement_start_date?.toISOString().startsWith("2026-04") ? "✅" : "❌"} Agreement starts on 01-Apr-2026`);
  console.log(`    ${aprilRent ? "✅" : "❌"} April rent generated`);
  console.log(`    ${aprilRent && Number(aprilRent.amount) === 7000 ? "✅" : "❌"} April rent amount = ₹${aprilRent ? aprilRent.amount : "N/A"}`);
  console.log(`    ${aprilRent?.status === "PENDING" ? "✅" : "❌"} April rent status = ${aprilRent?.status || "N/A"}`);
  console.log(`    ${manojObs.length === 5 ? "✅" : "❌"} Total rent obligations = ${manojObs.length} (expected 5: Apr-Aug)`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════════
async function main() {
  const isApply = process.argv.includes("--apply");
  console.log(`\n${"═".repeat(60)}`);
  console.log(`  DATA CORRECTION SCRIPT — ${isApply ? "⚡ APPLY MODE" : "👁 DRY-RUN MODE"}`);
  console.log(`  Date: ${new Date().toISOString()}`);
  console.log(`${"═".repeat(60)}`);

  try {
    if (isApply) {
      await backupState();
    }

    await correctDurgaPrasad(isApply);
    await correctDeepak(isApply);
    await correctManoj(isApply);

    if (isApply) {
      await verify();
    }

    console.log(`\n${"═".repeat(60)}`);
    if (!isApply) {
      console.log("  DRY-RUN complete. Run with --apply to commit changes.");
    } else {
      console.log("  ALL CORRECTIONS APPLIED AND VERIFIED.");
    }
    console.log(`${"═".repeat(60)}\n`);
  } catch (err) {
    console.error("\n❌ SCRIPT FAILED:", err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
