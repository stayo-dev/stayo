import { prisma } from "../lib/db";
import { invalidateOwnerDashboardCache, invalidatePortfolioCache } from "../lib/cache/dashboard-cache";
import { dashboardService } from "../lib/services/dashboard-service";
import { activityService } from "../lib/services/activity-service";
import { analyticsService } from "../lib/services/analytics-service";
import { agreementLifecycleRecoveryService } from "../src/services/tenants/agreement-lifecycle-recovery-service";
import { renewalDecisionService } from "../src/services/tenants/renewal-decision-service";
import { paymentService } from "../src/services/payments/payment-service";
import type { PrismaClient } from "@prisma/client";

const APPLY = process.argv.includes("--apply");
const RESET_CONFIRMATION = process.env.HMS_PRODUCTION_RESET_CONFIRMATION;
const TARGET_REF_ID = "iogmfxedhfcdtxoywwve";

type DbClient = PrismaClient | Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

const PRESERVED_TABLES = [
  "_prisma_migrations",
  "profiles", // Handled manually to preserve OWNER profiles
  "hostels",
  "floors",
  "rooms",
  "AgreementTemplate",
  "RuleVersion",
  "owner_whatsapp_identities",
  "whatsapp_owner_sessions",
  "message_packs",
  "system_locks",
  "expenses" // Handled manually to preserve production expense records and categories
];

function quoteIdent(identifier: string) {
  return `"${identifier.replace(/"/g, '""')}"`;
}

async function countTable(table: string, db: DbClient = prisma) {
  try {
    const rows = await db.$queryRawUnsafe<Array<{ count: bigint }>>(
      `select count(*)::bigint as count from ${quoteIdent(table)}`
    );
    return Number(rows[0]?.count || 0);
  } catch {
    return 0;
  }
}

async function getTablesToDelete() {
  const rows = await prisma.$queryRawUnsafe<Array<{ tablename: string }>>(
    `select tablename
     from pg_tables
     where schemaname = 'public'
       and tablename not in (${PRESERVED_TABLES.map((t, idx) => `$${idx + 1}`).join(", ")})
     order by tablename`,
    ...PRESERVED_TABLES
  );
  return rows.map((row) => row.tablename);
}

async function deletionOrder(tables: string[]) {
  const rows = await prisma.$queryRawUnsafe<Array<{ child: string; parent: string }>>(
    `select child.relname as child, parent.relname as parent
     from pg_constraint constraint_info
     join pg_class child on child.oid = constraint_info.conrelid
     join pg_namespace child_ns on child_ns.oid = child.relnamespace
     join pg_class parent on parent.oid = constraint_info.confrelid
     join pg_namespace parent_ns on parent_ns.oid = parent.relnamespace
     where constraint_info.contype = 'f'
       and child_ns.nspname = 'public'
       and parent_ns.nspname = 'public'`
  );

  const tableSet = new Set(tables);
  const childrenByParent = new Map<string, Set<string>>();
  for (const row of rows) {
    if (row.child === row.parent) continue;
    if (!tableSet.has(row.child) || !tableSet.has(row.parent)) continue;
    const children = childrenByParent.get(row.parent) || new Set<string>();
    children.add(row.child);
    childrenByParent.set(row.parent, children);
  }

  const ordered: string[] = [];
  const temporary = new Set<string>();
  const permanent = new Set<string>();

  function visit(table: string) {
    if (permanent.has(table)) return;
    if (temporary.has(table)) return;
    temporary.add(table);
    for (const child of childrenByParent.get(table) || []) {
      visit(child);
    }
    temporary.delete(table);
    permanent.add(table);
    ordered.push(table);
  }

  for (const table of tables) {
    visit(table);
  }

  return ordered;
}

function printInstructions() {
  console.log(`
========================================================================
🛡️  HMS V1 PRODUCTION RESET CHECKLIST & ROLLBACK INSTRUCTIONS  🛡️
========================================================================

1️⃣  BACKUP VERIFICATION CHECKLIST
- [ ] Connect to your database CLI / server.
- [ ] Run pg_dump to create a secure backup:
      pg_dump "$DATABASE_URL" --format=custom --file=backups/pre_reset_backup_$(date +%F_%T).dump
- [ ] Verify that the backup file size is greater than 0 bytes.
- [ ] Store the backup file in a secure, non-temporary directory.

2️⃣  ROLLBACK INSTRUCTIONS
To restore your database from this backup:
1. Terminate all active database connections (or restart database).
2. Run pg_restore:
   pg_restore --clean --no-owner --no-acl -d "$DATABASE_URL" backups/pre_reset_backup_xxxx.dump
========================================================================
`);
}

async function validatePreservedConfigurations(db: DbClient = prisma) {
  console.log("=== Validating Preserved Configurations ===");
  
  // 1. Check OWNER profiles
  const ownerCount = await db.profile.count({
    where: { role: "OWNER" }
  });
  console.log(`  - Preserved OWNER Profiles: ${ownerCount}`);
  if (ownerCount === 0) {
    throw new Error("Missing OWNER profile configuration!");
  }

  // 2. Check Hostels
  const hostelsCount = await db.hostels.count();
  console.log(`  - Hostels: ${hostelsCount}`);
  if (hostelsCount === 0) {
    throw new Error("Missing hostels configuration!");
  }

  // 3. Check Floors
  const floorsCount = await db.floors.count();
  console.log(`  - Floors: ${floorsCount}`);
  if (floorsCount === 0) {
    throw new Error("Missing floors configuration!");
  }

  // 4. Check Rooms
  const roomsCount = await db.rooms.count();
  console.log(`  - Rooms: ${roomsCount}`);
  if (roomsCount === 0) {
    throw new Error("Missing rooms configuration!");
  }

  // 5. Check AgreementTemplate
  const templatesCount = await db.agreementTemplate.count();
  console.log(`  - Agreement Templates: ${templatesCount}`);
  if (templatesCount === 0) {
    throw new Error("Missing agreement templates configuration!");
  }

  // 6. Check RuleVersion
  const rulesCount = await db.ruleVersion.count();
  console.log(`  - Rule Versions: ${rulesCount}`);
  if (rulesCount === 0) {
    throw new Error("Missing rule versions configuration!");
  }

  console.log("✅ Preserved configurations validation passed.");
}

async function getRoleCounts(db: DbClient = prisma): Promise<Record<string, number>> {
  const roles = await db.$queryRaw<Array<{ role: string; count: bigint }>>`
    select role::text as role, count(*)::bigint as count from "profiles" group by role
  `;
  const counts: Record<string, number> = { OWNER: 0, ADMIN: 0, WARDEN: 0, TENANT: 0 };
  for (const r of roles) {
    counts[r.role] = Number(r.count);
  }
  return counts;
}

async function runFinalRoleAudit(preOwnerCount: number, db: DbClient = prisma) {
  console.log("=== Running Final Role Audit ===");
  const auditResult = await getRoleCounts(db);

  console.log(JSON.stringify(auditResult, null, 2));

  // Fail validation if non-owner accounts remain
  if (auditResult.ADMIN > 0 || auditResult.WARDEN > 0 || auditResult.TENANT > 0) {
    throw new Error(`Validation failed: Non-owner accounts found! ADMIN: ${auditResult.ADMIN}, WARDEN: ${auditResult.WARDEN}, TENANT: ${auditResult.TENANT}`);
  }

  if (auditResult.OWNER !== preOwnerCount) {
    throw new Error(`Validation failed: Expected exactly ${preOwnerCount} OWNER profiles, found ${auditResult.OWNER}`);
  }

  console.log("✅ Final Role Audit validation passed (only OWNER profiles remaining, all others 0).");
}

async function runDashboardHealthChecks(db: DbClient = prisma) {
  // Invalidate all dashboard caches first
  const ownersList = await db.profile.findMany({
    where: { role: "OWNER" },
    select: { id: true }
  });
  for (const o of ownersList) {
    invalidateOwnerDashboardCache(o.id);
    invalidatePortfolioCache(o.id);
  }

  console.log("=== Running Zero-Tenant Dashboard Health Checks ===");
  const rangeStart = new Date();
  rangeStart.setMonth(rangeStart.getMonth() - 1);
  const rangeEnd = new Date();

  for (const owner of ownersList) {
    const hostelsList = await db.hostels.findMany({
      where: { owner_id: owner.id },
      select: { id: true }
    });

    for (const hostel of hostelsList) {
      console.log(`  - Checking dashboards for Owner: ${owner.id}, Hostel: ${hostel.id}`);

      // 1. Home Dashboard stats (getOwnerStatsShell, getMonthlyStats, getOwnerActivity)
      try {
        await dashboardService.getOwnerStatsShell(owner.id, hostel.id);
        await dashboardService.getMonthlyStats(owner.id, hostel.id, 6);
        await activityService.getOwnerActivity({ userId: owner.id, hostelId: hostel.id, limit: 5, offset: 0 });
        await dashboardService.getOwnerStats(owner.id, hostel.id);
        console.log(`    ✅ Home Dashboard health check passed.`);
      } catch (err: any) {
        throw new Error(`Home Dashboard health check failed for owner ${owner.id}: ${err.message || err}`);
      }

      // 2. Tenants Dashboard (getTenantIntelligenceDashboard)
      try {
        await analyticsService.getTenantIntelligenceDashboard(owner.id, rangeStart, rangeEnd, hostel.id);
        console.log(`    ✅ Tenants Dashboard health check passed.`);
      } catch (err: any) {
        throw new Error(`Tenants Dashboard health check failed for owner ${owner.id}: ${err.message || err}`);
      }

      // 3. Money Dashboard (getCashflowDashboard, getDuesReport)
      try {
        await analyticsService.getCashflowDashboard(owner.id, rangeStart, rangeEnd, hostel.id);
        await paymentService.getDuesReport(owner.id, hostel.id);
        console.log(`    ✅ Money Dashboard health check passed.`);
      } catch (err: any) {
        throw new Error(`Money Dashboard health check failed for owner ${owner.id}: ${err.message || err}`);
      }

      // 4. Agreements Dashboard (getRecoveryReport)
      try {
        await agreementLifecycleRecoveryService.getRecoveryReport({ ownerId: owner.id, hostelId: hostel.id });
        console.log(`    ✅ Agreements Dashboard health check passed.`);
      } catch (err: any) {
        throw new Error(`Agreements Dashboard health check failed for owner ${owner.id}: ${err.message || err}`);
      }

      // 5. Renewals Dashboard (getOwnerRenewalQueue)
      try {
        await renewalDecisionService.getOwnerRenewalQueue(owner.id, { hostelId: hostel.id, filter: "all" });
        console.log(`    ✅ Renewals Dashboard health check passed.`);
      } catch (err: any) {
        throw new Error(`Renewals Dashboard health check failed for owner ${owner.id}: ${err.message || err}`);
      }

      // 6. Alerts Dashboard Checks (pending documents, pending verification, move out requests)
      try {
        await db.identificationDocument.findMany({
          where: { document_status: "PENDING", is_active: true, tenant: { owner_id: owner.id, hostel_id: hostel.id } }
        });
        await db.paymentAttempt.findMany({
          where: { owner_id: owner.id, hostel_id: hostel.id, status: { in: ["PENDING_VERIFICATION", "PENDING_MANUAL_CONFIRMATION"] } }
        });
        await db.move_out_requests.findMany({
          where: { hostel_id: hostel.id, status: "REQUESTED" }
        });
        console.log(`    ✅ Alerts Dashboard health check passed.`);
      } catch (err: any) {
        throw new Error(`Alerts/Pending Counts health check failed for owner ${owner.id}: ${err.message || err}`);
      }
    }
  }
  console.log("✅ Zero-Tenant Dashboard Health Checks completed successfully.");
}

async function main() {
  printInstructions();

  const tables = await getTablesToDelete();
  const orderedTables = await deletionOrder(tables);

  const initialRoleCounts = await getRoleCounts(prisma);
  const preOwnerCount = initialRoleCounts.OWNER;
  const preHostelCount = await prisma.hostels.count();
  const preRoomCount = await prisma.rooms.count();
  const preBedsCount = await prisma.rooms.aggregate({
    where: { is_active: true },
    _sum: { capacity: true }
  }).then(res => Number(res._sum.capacity || 0));
  const preTemplateCount = await prisma.agreementTemplate.count();
  const preExpenseCount = await countTable("expenses");

  // Capture payment configurations for each hostel to verify no mutation
  const preHostelsConfig = await prisma.hostels.findMany({
    select: {
      id: true,
      upi_id: true,
      phonepe_merchant_id: true,
      preferences_config: true,
      timezone: true,
      rent_cycle: true,
      auto_rent_day: true
    }
  });

  const beforeCounts: Record<string, number> = {
    profiles_total: await countTable("profiles"),
    profiles_OWNER: initialRoleCounts.OWNER,
    profiles_ADMIN: initialRoleCounts.ADMIN,
    profiles_WARDEN: initialRoleCounts.WARDEN,
    profiles_TENANT: initialRoleCounts.TENANT,
    beds: preBedsCount
  };

  for (const table of tables) {
    beforeCounts[table] = await countTable(table);
  }
  beforeCounts["expenses"] = preExpenseCount;

  if (!APPLY) {
    console.log(JSON.stringify({
      mode: "DRY_RUN",
      target_ref_id: TARGET_REF_ID,
      preserved_tables: PRESERVED_TABLES,
      tables_to_delete_ordered: orderedTables,
      before_counts: beforeCounts,
      apply_command: "HMS_PRODUCTION_RESET_CONFIRMATION=iogmfxedhfcdtxoywwve npm run reset:production:keep-owner -- --apply",
    }, null, 2));

    await validatePreservedConfigurations();
    return;
  }

  if (RESET_CONFIRMATION !== TARGET_REF_ID) {
    console.error(`❌ Error: HMS_PRODUCTION_RESET_CONFIRMATION must match target reference ID '${TARGET_REF_ID}'`);
    process.exit(1);
  }

  // Pre-reset validations
  await validatePreservedConfigurations();

  console.log("\n🚀 Starting destructive launch reset inside a transaction...");
  const result = await prisma.$transaction(async (tx) => {
    const deletedRowCounts: Record<string, number> = {};

    // 1. Disable user triggers on the payments table to bypass ledger protections
    if (orderedTables.includes("payments")) {
      console.log("  - Disabling user triggers on 'payments' table...");
      await tx.$executeRawUnsafe('ALTER TABLE "payments" DISABLE TRIGGER USER');
    }

    // 2. Remove foreign key relations pointing to imports
    await tx.$executeRawUnsafe(`update "profiles" set import_batch_id = null where import_batch_id is not null`);

    // 3. Delete operational data tables in topological order
    for (const table of orderedTables) {
      const count = await countTable(table, tx);
      await tx.$executeRawUnsafe("delete from " + quoteIdent(table));
      deletedRowCounts[table] = count;
      console.log(`  - Deleted ${count} rows from ${table}`);
    }

    // 4. Delete non-owner profiles (ADMIN, WARDEN, TENANT)
    const nonOwnerCount = await tx.profile.count({ where: { role: { not: "OWNER" } } });
    await tx.$executeRawUnsafe(`delete from "profiles" where role <> 'OWNER'`);
    deletedRowCounts["profiles_NON_OWNERS"] = nonOwnerCount;
    console.log(`  - Deleted ${nonOwnerCount} non-owner profiles`);

    // 5. Selective Expenses deletion: Preserve expense categories but delete expense records unless marked as production data
    const expenseDeleteResult = await tx.$executeRawUnsafe(`
      DELETE FROM expenses 
      WHERE NOT (
        tags @> array['production'] 
        OR (metadata->>'is_production') = 'true' 
        OR (metadata->>'production') = 'true'
        OR title ILIKE '%production%' 
        OR notes ILIKE '%production%'
      )
    `);
    const postExpenseCount = await countTable("expenses", tx);
    const deletedExpensesCount = preExpenseCount - postExpenseCount;
    deletedRowCounts["expenses"] = deletedExpensesCount;
    console.log(`  - Deleted ${deletedExpensesCount} expense records (preserved ${postExpenseCount} production expenses)`);

    // Note: auth.users cleanup skipped as requested ("Do not delete from auth.users automatically")

    // 6. Re-enable user triggers on 'payments'
    if (orderedTables.includes("payments")) {
      console.log("  - Re-enabling user triggers on 'payments' table...");
      await tx.$executeRawUnsafe('ALTER TABLE "payments" ENABLE TRIGGER USER');
    }

    // 7. Post-reset validations inside transaction
    await validatePreservedConfigurations(tx);
    await runFinalRoleAudit(preOwnerCount, tx);

    // Verify operational counts are zero
    const activeTenants = await tx.tenants.count({ where: { status: "ACTIVE" } });
    const totalTenants = await tx.tenants.count();
    const activeAgreements = await tx.agreement.count({ where: { status: "SIGNED" } });
    const totalAgreements = await tx.agreement.count();
    const activeAllocations = await tx.roomAllocation.count({ where: { is_active: true } });
    const totalAllocations = await tx.roomAllocation.count();
    const obligations = await tx.rent_obligations.count();
    const paymentAttempts = await tx.paymentAttempt.count();
    const ledgerEntries = await tx.tenant_financial_ledger.count();
    const renewalOffers = await tx.renewalOffer.count();
    const moveOutRequests = await tx.move_out_requests.count();

    console.log("=== Verifying Operational Data Purge ===");
    console.log(`  - Active Tenants: ${activeTenants} (Total: ${totalTenants})`);
    console.log(`  - Active Agreements: ${activeAgreements} (Total: ${totalAgreements})`);
    console.log(`  - Active Allocations: ${activeAllocations} (Total: ${totalAllocations})`);
    console.log(`  - Obligations: ${obligations}`);
    console.log(`  - Payment Attempts: ${paymentAttempts}`);
    console.log(`  - Ledger Entries: ${ledgerEntries}`);
    console.log(`  - Renewal Offers: ${renewalOffers}`);
    console.log(`  - Move-out Requests: ${moveOutRequests}`);

    if (
      activeTenants !== 0 ||
      totalTenants !== 0 ||
      activeAgreements !== 0 ||
      totalAgreements !== 0 ||
      activeAllocations !== 0 ||
      totalAllocations !== 0 ||
      obligations !== 0 ||
      paymentAttempts !== 0 ||
      ledgerEntries !== 0 ||
      renewalOffers !== 0 ||
      moveOutRequests !== 0
    ) {
      throw new Error("Validation failed: Some operational entities were not completely purged!");
    }

    // Verify preserved counts remain identical
    const postOwnerCount = await tx.profile.count({ where: { role: "OWNER" } });
    const postHostelCount = await tx.hostels.count();
    const postRoomCount = await tx.rooms.count();
    const postBedsCount = await tx.rooms.aggregate({
      where: { is_active: true },
      _sum: { capacity: true }
    }).then(res => Number(res._sum.capacity || 0));
    const postTemplateCount = await tx.agreementTemplate.count();

    if (
      preOwnerCount !== postOwnerCount ||
      preHostelCount !== postHostelCount ||
      preRoomCount !== postRoomCount ||
      preBedsCount !== postBedsCount ||
      preTemplateCount !== postTemplateCount
    ) {
      throw new Error("Validation failed: Preserved entity counts do not match pre-reset counts!");
    }

    // Verify payment configurations are exactly identical
    const postHostelsConfig = await tx.hostels.findMany({
      select: {
        id: true,
        upi_id: true,
        phonepe_merchant_id: true,
        preferences_config: true,
        timezone: true,
        rent_cycle: true,
        auto_rent_day: true
      }
    });

    for (const preConfig of preHostelsConfig) {
      const postConfig = postHostelsConfig.find(h => h.id === preConfig.id);
      if (!postConfig) {
        throw new Error(`Hostel ${preConfig.id} was not preserved!`);
      }
      if (
        postConfig.upi_id !== preConfig.upi_id ||
        postConfig.phonepe_merchant_id !== preConfig.phonepe_merchant_id ||
        postConfig.timezone !== preConfig.timezone ||
        postConfig.rent_cycle !== preConfig.rent_cycle ||
        postConfig.auto_rent_day !== preConfig.auto_rent_day ||
        JSON.stringify(postConfig.preferences_config) !== JSON.stringify(preConfig.preferences_config)
      ) {
        throw new Error(`Validation failed: Payment configuration/settings for hostel ${preConfig.id} were mutated or lost!`);
      }
    }

    console.log("✅ Post-reset integrity check validations passed successfully.");

    // 8. Run dashboard health checks to ensure dashboards load successfully with 0 tenants
    await runDashboardHealthChecks(tx);

    const finalRoleCounts = await getRoleCounts(tx);
    const afterCounts: Record<string, number> = {
      profiles_total: await countTable("profiles", tx),
      profiles_OWNER: finalRoleCounts.OWNER,
      profiles_ADMIN: finalRoleCounts.ADMIN,
      profiles_WARDEN: finalRoleCounts.WARDEN,
      profiles_TENANT: finalRoleCounts.TENANT,
      beds: postBedsCount
    };
    for (const table of tables) {
      afterCounts[table] = await countTable(table, tx);
    }
    afterCounts["expenses"] = postExpenseCount;

    return { deletedRowCounts, afterCounts };
  }, { maxWait: 15000, timeout: 120000 });

  console.log("\n========================================================================");
  console.log("🏆 HMS V1 PRODUCTION RESET APPLIED & VERIFIED SUCCESSFULLY 🏆");
  console.log("========================================================================\n");
  console.log(JSON.stringify({
    mode: "APPLIED",
    deleted_row_counts: result.deletedRowCounts,
    after_counts: result.afterCounts
  }, null, 2));
}

main()
  .catch((error) => {
    console.error("❌ Reset script failed:", error.message || error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
