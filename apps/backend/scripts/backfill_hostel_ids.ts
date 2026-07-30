/**
 * Multi-hostel operational backfill entrypoint.
 *
 * This script is intentionally idempotent and can be run with `--dry-run`.
 * It delegates the core dependency-ordered historical backfill to the existing
 * phase2 script, then reports remaining operational gaps that must be resolved
 * before applying non-null database constraints.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const DRY_RUN = process.argv.includes("--dry-run");

async function execute(sql: string) {
  if (DRY_RUN) {
    return 0;
  }
  const rows = await prisma.$queryRawUnsafe<any[]>(sql);
  return rows.length;
}

async function backfillExpenses() {
  return execute(`
    UPDATE expenses e
    SET hostel_id = source.hostel_id
    FROM (
      SELECT DISTINCT ON (t.owner_id) t.owner_id, t.hostel_id
      FROM tenants t
      WHERE t.hostel_id IS NOT NULL
      ORDER BY t.owner_id, t.updated_at DESC NULLS LAST, t.created_at DESC
    ) source
    WHERE e.hostel_id IS NULL
      AND e.owner_id = source.owner_id
    RETURNING e.id
  `);
}

async function backfillComplaints() {
  return execute(`
    UPDATE complaints c
    SET hostel_id = t.hostel_id
    FROM tenants t
    WHERE c.hostel_id IS NULL
      AND c.tenant_id = t.id
      AND t.hostel_id IS NOT NULL
    RETURNING c.id
  `);
}

async function reportNulls() {
  const rows = await prisma.$queryRawUnsafe<Array<{ table_name: string; missing: bigint }>>(`
    SELECT * FROM (
      SELECT 'tenants_active' AS table_name, COUNT(*) AS missing FROM tenants WHERE status = 'ACTIVE' AND hostel_id IS NULL
      UNION ALL SELECT 'room_allocations', COUNT(*) FROM room_allocations WHERE hostel_id IS NULL
      UNION ALL SELECT 'rent_obligations', COUNT(*) FROM rent_obligations WHERE hostel_id IS NULL
      UNION ALL SELECT 'payments', COUNT(*) FROM payments WHERE hostel_id IS NULL
      UNION ALL SELECT 'receipts', COUNT(*) FROM receipts WHERE hostel_id IS NULL
      UNION ALL SELECT 'expenses', COUNT(*) FROM expenses WHERE hostel_id IS NULL
      UNION ALL SELECT 'complaints', COUNT(*) FROM complaints WHERE hostel_id IS NULL
      UNION ALL SELECT 'reminder_logs', COUNT(*) FROM reminder_logs WHERE hostel_id IS NULL
      UNION ALL SELECT 'rent_generation_ledgers', COUNT(*) FROM rent_generation_ledgers WHERE hostel_id IS NULL
    ) checks
    ORDER BY table_name
  `);

  console.log("\nRemaining NULL hostel_id report");
  rows.forEach((row) => console.log(`${row.table_name}: ${Number(row.missing)}`));
  return rows.reduce((sum, row) => sum + Number(row.missing), 0);
}

async function main() {
  console.log(`Backfill hostel IDs (${DRY_RUN ? "dry-run" : "live"})`);
  console.log("Run phase2_backfill_hostels.ts first for allocation/obligation/payment/receipt/reminder/tenant lineage.");
  console.log(`expenses updated: ${await backfillExpenses()}`);
  console.log(`complaints updated: ${await backfillComplaints()}`);
  const remaining = await reportNulls();
  if (remaining > 0) {
    console.error(`Unresolved operational rows remain: ${remaining}`);
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
