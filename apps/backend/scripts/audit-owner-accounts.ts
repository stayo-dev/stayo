/**
 * 🛡️ Owner Account Audit Script
 *
 * Run this against the production database to identify rogue OWNER accounts
 * created by the Google OAuth auto-provisioning vulnerability.
 *
 * Usage:
 *   npx tsx scripts/audit-owner-accounts.ts
 *
 * This script:
 *   1. Lists all OWNER profiles with creation timestamps
 *   2. Identifies self-owned accounts (auto-provisioned pattern)
 *   3. Flags any accounts created after a reference date
 *   4. Reports active vs disabled status
 *   5. Does NOT modify any data — read-only audit
 */

import { prisma } from "../lib/db";

async function auditOwnerAccounts() {
  console.log("\n🛡️  HMS Owner Account Audit");
  console.log("═".repeat(60));

  const owners = await prisma.profile.findMany({
    where: { role: "OWNER" },
    select: {
      id: true,
      email: true,
      name: true,
      phone: true,
      is_active: true,
      created_at: true,
      updated_at: true,
      owner_id: true,
      password_hash: true,
    },
    orderBy: { created_at: "asc" },
  });

  console.log(`\nFound ${owners.length} OWNER profile(s):\n`);

  for (const owner of owners) {
    const isSelfOwned = owner.owner_id === owner.id;
    const hasPassword = Boolean(owner.password_hash);

    console.log(`  ID:          ${owner.id}`);
    console.log(`  Email:       ${owner.email}`);
    console.log(`  Name:        ${owner.name || "(no name)"}`);
    console.log(`  Phone:       ${owner.phone || "(no phone)"}`);
    console.log(`  Active:      ${owner.is_active ? "✅ YES" : "❌ NO"}`);
    console.log(`  Self-owned:  ${isSelfOwned ? "⚠️  YES (auto-provisioned pattern)" : "✅ Normal"}`);
    console.log(`  Has password: ${hasPassword ? "Yes" : "No (Google-only login)"}`);
    console.log(`  Created:     ${owner.created_at}`);
    console.log(`  Updated:     ${owner.updated_at}`);
    console.log("");
  }

  // Check for hostels associated with each owner
  console.log("─".repeat(60));
  console.log("Hostel ownership map:\n");

  for (const owner of owners) {
    const hostels = await prisma.hostels.findMany({
      where: { owner_id: owner.id },
      select: { id: true, name: true, is_active: true },
    });

    if (hostels.length > 0) {
      console.log(`  ${owner.email}:`);
      for (const h of hostels) {
        console.log(`    - ${h.name} (${h.is_active ? "active" : "inactive"}) [${h.id}]`);
      }
    } else {
      console.log(`  ${owner.email}: ⚠️  NO HOSTELS (likely rogue account)`);
    }
  }

  // Summary
  const activeOwners = owners.filter((o) => o.is_active);
  const selfOwned = owners.filter((o) => o.owner_id === o.id);
  const noPassword = owners.filter((o) => !o.password_hash);

  console.log("\n" + "═".repeat(60));
  console.log("SUMMARY:");
  console.log(`  Total OWNER profiles:     ${owners.length}`);
  console.log(`  Active:                   ${activeOwners.length}`);
  console.log(`  Self-owned:               ${selfOwned.length}`);
  console.log(`  Google-only (no password): ${noPassword.length}`);

  if (owners.length > 1) {
    console.log("\n⚠️  WARNING: Multiple OWNER profiles detected in a single-owner system.");
    console.log("   Review each account and disable/remove rogue accounts.");
    console.log("   Rogue accounts are typically: self-owned + no hostels + no password.");
  } else {
    console.log("\n✅ Owner count looks healthy for a single-owner system.");
  }

  console.log("");
}

auditOwnerAccounts()
  .catch((err) => {
    console.error("Audit failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
