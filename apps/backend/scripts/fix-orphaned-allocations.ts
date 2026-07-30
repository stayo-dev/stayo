/**
 * Data Repair Script: Fix Orphaned Room Allocations
 * 
 * Fixes allocations that have end_date set but is_active still true,
 * which causes duplicate rent generation.
 * 
 * Also deletes any rent obligations tied to those orphaned allocations
 * that have no payments.
 * 
 * Run with: npx tsx scripts/fix-orphaned-allocations.ts
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("🔍 Scanning for orphaned allocations (end_date set, is_active still true)...\n");

  // Step 1: Find orphaned allocations
  const orphaned = await prisma.roomAllocation.findMany({
    where: {
      end_date: { not: null },
      is_active: true,
    },
    include: {
      room: { select: { room_no: true } },
      tenant: { select: { profile: { select: { name: true } } } },
    },
  });

  if (orphaned.length === 0) {
    console.log("✅ No orphaned allocations found. Database is clean.\n");
    return;
  }

  console.log(`⚠️  Found ${orphaned.length} orphaned allocation(s):\n`);
  for (const a of orphaned) {
    console.log(`  ${a.tenant.profile?.name} | Room ${a.room.room_no} | ended: ${a.end_date} | id: ${a.id}`);
  }

  // Step 2: Fix is_active on orphaned allocations
  const fixResult = await prisma.roomAllocation.updateMany({
    where: {
      end_date: { not: null },
      is_active: true,
    },
    data: {
      is_active: false,
    },
  });
  console.log(`\n✅ Fixed ${fixResult.count} orphaned allocation(s) → is_active = false\n`);

  // Step 3: Find and clean up duplicate rent obligations with no payments
  console.log("🔍 Checking for duplicate rent obligations tied to orphaned allocations...\n");
  
  for (const alloc of orphaned) {
    const obligations = await prisma.rentObligation.findMany({
      where: { allocation_id: alloc.id },
      include: {
        payments: { select: { id: true } },
        attempts: { select: { id: true } },
      },
    });

    for (const ob of obligations) {
      if (ob.payments.length === 0 && ob.attempts.length === 0) {
        await prisma.rentObligation.delete({ where: { id: ob.id } });
        console.log(`  🗑️  Deleted orphaned rent entry: ${ob.id} (₹${ob.amount}, ${ob.rent_month.toISOString().slice(0, 7)})`);
      } else {
        console.log(`  ⚠️  Kept rent entry ${ob.id} — has ${ob.payments.length} payment(s), ${ob.attempts.length} attempt(s)`);
      }
    }
  }

  console.log("\n✅ Data repair complete.\n");
}

main()
  .catch((e) => {
    console.error("❌ Script failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
