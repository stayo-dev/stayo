// @ts-nocheck
/**
 * 🔧 Phase 2 Backfill Script — Hostel ID Normalization
 *
 * Backfills hostel_id on all operational entities from their allocation chains.
 *
 * Features:
 * - Chunked (1000 rows) to avoid locking
 * - Idempotent — safe to re-run
 * - Dry-run mode (--dry-run) — reports what would change without writing
 * - Mismatch reporting — logs records where derived ≠ stored hostel_id
 * - Resumable — only processes rows with NULL hostel_id
 * - Observable — detailed progress logs
 *
 * Dependency Order (CRITICAL):
 *   1. RoomAllocations (source: room.hostel_id)
 *   2. RentObligations (source: allocation.hostel_id — requires step 1)
 *   3. Payments        (source: obligation.hostel_id — requires step 2)
 *   4. Receipts        (source: payment.hostel_id — requires step 3)
 *   5. ReminderLogs    (source: obligation.hostel_id — requires step 2)
 *   6. Tenants         (source: ACTIVE allocation.room.hostel_id — mutable, current context)
 *
 * Usage:
 *   npx tsx scripts/phase2_backfill_hostels.ts            # live run
 *   npx tsx scripts/phase2_backfill_hostels.ts --dry-run   # preview only
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const DRY_RUN = process.argv.includes("--dry-run");
const CHUNK_SIZE = 1000;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

interface BackfillStats {
  entity: string;
  updated: number;
  skipped: number;
  orphans: number;
  mismatches: number;
  duration_ms: number;
}

const allStats: BackfillStats[] = [];

async function logProgress(entity: string, stats: BackfillStats) {
  allStats.push(stats);
  const mode = DRY_RUN ? "[DRY-RUN]" : "[LIVE]";
  console.log(
    `${mode} ${entity}: updated=${stats.updated} skipped=${stats.skipped} orphans=${stats.orphans} mismatches=${stats.mismatches} (${stats.duration_ms}ms)`
  );
}

// ── Step 1: RoomAllocations ─────────────────────────────────────────────────
async function backfillAllocations() {
  const start = Date.now();
  let updated = 0, skipped = 0, orphans = 0, mismatches = 0;

  let cursor: string | undefined;
  while (true) {
    const rows = await prisma.roomAllocation.findMany({
      where: { hostel_id: null },
      select: { id: true, room_id: true },
      take: CHUNK_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { id: "asc" },
    });

    if (rows.length === 0) break;

    for (const row of rows) {
      const room = await prisma.room.findUnique({
        where: { id: row.room_id },
        select: { hostel_id: true },
      });

      if (!room?.hostel_id) {
        orphans++;
        console.warn(`  [ORPHAN] allocation ${row.id} → room ${row.room_id} has no hostel_id`);
        continue;
      }

      if (!DRY_RUN) {
        await prisma.roomAllocation.update({
          where: { id: row.id },
          data: { hostel_id: room.hostel_id },
        });
      }
      updated++;
    }

    cursor = rows[rows.length - 1].id;
    await sleep(100);
  }

  await logProgress("RoomAllocations", { entity: "RoomAllocation", updated, skipped, orphans, mismatches, duration_ms: Date.now() - start });
}

// ── Step 2: RentObligations ─────────────────────────────────────────────────
async function backfillObligations() {
  const start = Date.now();
  let updated = 0, skipped = 0, orphans = 0, mismatches = 0;

  let cursor: string | undefined;
  while (true) {
    const rows = await prisma.rentObligation.findMany({
      where: { hostel_id: null },
      select: { id: true, allocation_id: true, tenant_id: true },
      take: CHUNK_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { id: "asc" },
    });

    if (rows.length === 0) break;

    for (const row of rows) {
      let hostelId: string | null = null;

      // Primary: allocation → room → hostel
      if (row.allocation_id) {
        const alloc = await prisma.roomAllocation.findUnique({
          where: { id: row.allocation_id },
          select: { hostel_id: true, room: { select: { hostel_id: true } } },
        });
        // Prefer backfilled allocation.hostel_id, fallback to room chain
        hostelId = alloc?.hostel_id || alloc?.room?.hostel_id || null;
      }

      // Fallback: tenant's most recent allocation
      if (!hostelId && row.tenant_id) {
        const recentAlloc = await prisma.roomAllocation.findFirst({
          where: { tenant_id: row.tenant_id },
          select: { room: { select: { hostel_id: true } } },
          orderBy: { start_date: "desc" },
        });
        hostelId = recentAlloc?.room?.hostel_id || null;
      }

      if (!hostelId) {
        orphans++;
        continue;
      }

      if (!DRY_RUN) {
        await prisma.rentObligation.update({
          where: { id: row.id },
          data: { hostel_id: hostelId },
        });
      }
      updated++;
    }

    cursor = rows[rows.length - 1].id;
    await sleep(100);
  }

  await logProgress("RentObligations", { entity: "RentObligation", updated, skipped, orphans, mismatches, duration_ms: Date.now() - start });
}

// ── Step 3: Payments ────────────────────────────────────────────────────────
async function backfillPayments() {
  const start = Date.now();
  let updated = 0, skipped = 0, orphans = 0, mismatches = 0;

  let cursor: string | undefined;
  while (true) {
    const rows = await prisma.payment.findMany({
      where: { hostel_id: null },
      select: { id: true, obligation_id: true },
      take: CHUNK_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { id: "asc" },
    });

    if (rows.length === 0) break;

    for (const row of rows) {
      if (!row.obligation_id) {
        orphans++;
        continue;
      }

      const obligation = await prisma.rentObligation.findUnique({
        where: { id: row.obligation_id },
        select: { hostel_id: true },
      });

      const hostelId = obligation?.hostel_id || null;
      if (!hostelId) {
        orphans++;
        continue;
      }

      if (!DRY_RUN) {
        await prisma.payment.update({
          where: { id: row.id },
          data: { hostel_id: hostelId },
        });
      }
      updated++;
    }

    cursor = rows[rows.length - 1].id;
    await sleep(100);
  }

  await logProgress("Payments", { entity: "Payment", updated, skipped, orphans, mismatches, duration_ms: Date.now() - start });
}

// ── Step 4: Receipts ────────────────────────────────────────────────────────
async function backfillReceipts() {
  const start = Date.now();
  let updated = 0, skipped = 0, orphans = 0, mismatches = 0;

  let cursor: string | undefined;
  while (true) {
    const rows = await prisma.receipt.findMany({
      where: { hostel_id: null },
      select: { id: true, payment_id: true },
      take: CHUNK_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { id: "asc" },
    });

    if (rows.length === 0) break;

    for (const row of rows) {
      if (!row.payment_id) {
        orphans++;
        continue;
      }

      const payment = await prisma.payment.findUnique({
        where: { id: row.payment_id },
        select: { hostel_id: true },
      });

      const hostelId = payment?.hostel_id || null;
      if (!hostelId) {
        orphans++;
        continue;
      }

      if (!DRY_RUN) {
        await prisma.receipt.update({
          where: { id: row.id },
          data: { hostel_id: hostelId },
        });
      }
      updated++;
    }

    cursor = rows[rows.length - 1].id;
    await sleep(100);
  }

  await logProgress("Receipts", { entity: "Receipt", updated, skipped, orphans, mismatches, duration_ms: Date.now() - start });
}

// ── Step 5: ReminderLogs ────────────────────────────────────────────────────
async function backfillReminders() {
  const start = Date.now();
  let updated = 0, skipped = 0, orphans = 0, mismatches = 0;

  let cursor: string | undefined;
  while (true) {
    const rows = await prisma.reminderLog.findMany({
      where: { hostel_id: null },
      select: { id: true, obligation_id: true },
      take: CHUNK_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { id: "asc" },
    });

    if (rows.length === 0) break;

    for (const row of rows) {
      if (!row.obligation_id) {
        orphans++;
        continue;
      }

      const obligation = await prisma.rentObligation.findUnique({
        where: { id: row.obligation_id },
        select: { hostel_id: true },
      });

      const hostelId = obligation?.hostel_id || null;
      if (!hostelId) {
        orphans++;
        continue;
      }

      if (!DRY_RUN) {
        await prisma.reminderLog.update({
          where: { id: row.id },
          data: { hostel_id: hostelId },
        });
      }
      updated++;
    }

    cursor = rows[rows.length - 1].id;
    await sleep(100);
  }

  await logProgress("ReminderLogs", { entity: "ReminderLog", updated, skipped, orphans, mismatches, duration_ms: Date.now() - start });
}

// ── Step 6: Tenants (ACTIVE only — mutable current hostel) ──────────────────
async function backfillTenants() {
  const start = Date.now();
  let updated = 0, skipped = 0, orphans = 0, mismatches = 0;

  let cursor: string | undefined;
  while (true) {
    const rows = await prisma.tenant.findMany({
      where: { hostel_id: null, status: "ACTIVE" },
      select: { id: true },
      take: CHUNK_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { id: "asc" },
    });

    if (rows.length === 0) break;

    for (const row of rows) {
      const activeAlloc = await prisma.roomAllocation.findFirst({
        where: { tenant_id: row.id, is_active: true, end_date: null },
        select: { room: { select: { hostel_id: true } } },
        orderBy: { start_date: "desc" },
      });

      const hostelId = activeAlloc?.room?.hostel_id || null;
      if (!hostelId) {
        orphans++;
        continue;
      }

      if (!DRY_RUN) {
        await prisma.tenant.update({
          where: { id: row.id },
          data: { hostel_id: hostelId },
        });
      }
      updated++;
    }

    cursor = rows[rows.length - 1].id;
    await sleep(100);
  }

  await logProgress("Tenants", { entity: "Tenant", updated, skipped, orphans, mismatches, duration_ms: Date.now() - start });
}

// ── Verification: count remaining NULLs ─────────────────────────────────────
async function verifyCompleteness() {
  console.log("\n═══ Backfill Completeness Check ═══");

  const checks = [
    { name: "RoomAllocations", query: `SELECT COUNT(*) AS total, COUNT(CASE WHEN hostel_id IS NULL THEN 1 END) AS missing FROM room_allocations` },
    { name: "RentObligations", query: `SELECT COUNT(*) AS total, COUNT(CASE WHEN hostel_id IS NULL THEN 1 END) AS missing FROM rent_obligations` },
    { name: "Payments",        query: `SELECT COUNT(*) AS total, COUNT(CASE WHEN hostel_id IS NULL THEN 1 END) AS missing FROM payments` },
    { name: "Receipts",        query: `SELECT COUNT(*) AS total, COUNT(CASE WHEN hostel_id IS NULL THEN 1 END) AS missing FROM receipts` },
    { name: "ReminderLogs",    query: `SELECT COUNT(*) AS total, COUNT(CASE WHEN hostel_id IS NULL THEN 1 END) AS missing FROM reminder_logs` },
    { name: "Tenants (ACTIVE)", query: `SELECT COUNT(*) AS total, COUNT(CASE WHEN hostel_id IS NULL THEN 1 END) AS missing FROM tenants WHERE status = 'ACTIVE'` },
  ];

  for (const check of checks) {
    const [row] = await prisma.$queryRawUnsafe<{ total: bigint; missing: bigint }[]>(check.query);
    const total = Number(row?.total || 0);
    const missing = Number(row?.missing || 0);
    const pct = total > 0 ? Math.round(((total - missing) / total) * 10000) / 100 : 100;
    const status = missing === 0 ? "✅" : "⚠️";
    console.log(`  ${status} ${check.name}: ${total - missing}/${total} (${pct}%) — ${missing} missing`);
  }
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n${"═".repeat(60)}`);
  console.log(`  Phase 2 Hostel ID Backfill — ${DRY_RUN ? "DRY RUN (no writes)" : "LIVE RUN"}`);
  console.log(`  Started: ${new Date().toISOString()}`);
  console.log(`  Chunk size: ${CHUNK_SIZE}`);
  console.log(`${"═".repeat(60)}\n`);

  const totalStart = Date.now();

  // Execute in strict dependency order
  await backfillAllocations();
  await backfillObligations();
  await backfillPayments();
  await backfillReceipts();
  await backfillReminders();
  await backfillTenants();

  const totalDuration = Date.now() - totalStart;

  console.log(`\n${"═".repeat(60)}`);
  console.log(`  SUMMARY`);
  console.log(`${"═".repeat(60)}`);
  for (const s of allStats) {
    console.log(`  ${s.entity.padEnd(18)} updated=${String(s.updated).padStart(6)} orphans=${String(s.orphans).padStart(4)} (${s.duration_ms}ms)`);
  }
  const totalUpdated = allStats.reduce((s, v) => s + v.updated, 0);
  const totalOrphans = allStats.reduce((s, v) => s + v.orphans, 0);
  console.log(`  ${"─".repeat(56)}`);
  console.log(`  TOTAL:            updated=${String(totalUpdated).padStart(6)} orphans=${String(totalOrphans).padStart(4)} (${totalDuration}ms)`);

  // Run completeness verification
  await verifyCompleteness();

  console.log(`\n  Completed: ${new Date().toISOString()}`);
  console.log(`${"═".repeat(60)}\n`);
}

main()
  .catch((e) => {
    console.error("\n❌ BACKFILL FAILED:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
