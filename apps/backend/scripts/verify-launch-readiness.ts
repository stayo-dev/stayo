import { prisma } from "../lib/db";

const PRESERVED_TABLES = [
  "hostels",
  "floors",
  "rooms",
  "AgreementTemplate",
  "RuleVersion",
  "owner_whatsapp_identities",
  "owner_dashboard_snapshots" // Dashboard cache tracking table
];

async function countTable(table: string) {
  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      `select count(*)::bigint as count from "${table}"`
    );
    return Number(rows[0]?.count || 0);
  } catch {
    return 0;
  }
}

async function getTablesToDelete() {
  const preservedList = [
    "_prisma_migrations",
    "profiles",
    "hostels",
    "floors",
    "rooms",
    "AgreementTemplate",
    "RuleVersion",
    "owner_whatsapp_identities",
    "owner_dashboard_snapshots",
    "whatsapp_owner_sessions",
    "message_packs",
    "system_locks"
  ];
  const rows = await prisma.$queryRawUnsafe<Array<{ tablename: string }>>(
    `select tablename
     from pg_tables
     where schemaname = 'public'
       and tablename not in (${preservedList.map((t, idx) => `$${idx + 1}`).join(", ")})
     order by tablename`,
    ...preservedList
  );
  return rows.map((row) => row.tablename);
}

async function main() {
  console.log("=== HMS Launch Readiness Verification Audit ===");

  let failed = false;

  // 1. Profile Verification
  console.log("\n1. Auditing User Profiles:");
  const profiles = await prisma.profile.findMany();
  console.log(`- Total Profiles remaining: ${profiles.length}`);
  
  const roles = await prisma.$queryRaw<Array<{ role: string; count: bigint }>>`
    select role::text as role, count(*)::bigint as count from "profiles" group by role
  `;
  const roleCounts: Record<string, number> = { OWNER: 0, ADMIN: 0, WARDEN: 0, TENANT: 0 };
  for (const r of roles) {
    roleCounts[r.role] = Number(r.count);
  }
  
  console.log(`  - OWNER: ${roleCounts.OWNER}`);
  console.log(`  - ADMIN: ${roleCounts.ADMIN}`);
  console.log(`  - WARDEN: ${roleCounts.WARDEN}`);
  console.log(`  - TENANT: ${roleCounts.TENANT}`);

  if (roleCounts.OWNER !== 1) {
    console.error(`❌ FAILURE: Expected exactly 1 OWNER profile, found ${roleCounts.OWNER}`);
    failed = true;
  }
  if (roleCounts.ADMIN > 0 || roleCounts.WARDEN > 0 || roleCounts.TENANT > 0) {
    console.error("❌ FAILURE: Non-owner roles remain in the system!");
    failed = true;
  }

  // 2. Physical Infrastructure Verification
  console.log("\n2. Auditing Preserved Infrastructure & Configs:");
  for (const table of PRESERVED_TABLES) {
    const count = await countTable(table);
    console.log(`  - Table "${table}": ${count} rows`);
    if (count === 0 && table !== "owner_whatsapp_identities" && table !== "owner_dashboard_snapshots") {
      console.error(`❌ FAILURE: Preserved table "${table}" is empty!`);
      failed = true;
    }
  }

  // 3. Operational Data Purge Verification
  console.log("\n3. Auditing Operational Table Purges (Should be 0):");
  const tablesToDelete = await getTablesToDelete();
  let nonZeroCount = 0;
  for (const table of tablesToDelete) {
    const count = await countTable(table);
    if (count > 0) {
      console.error(`❌ FAILURE: Table "${table}" has ${count} rows! Expected 0.`);
      nonZeroCount++;
      failed = true;
    }
  }

  if (nonZeroCount === 0) {
    console.log("✅ All operational tables are confirmed empty.");
  } else {
    console.error(`❌ FAILURE: ${nonZeroCount} operational tables were NOT completely cleared!`);
  }

  console.log("\n=== Audit Conclusion ===");
  if (failed) {
    console.error("❌ LAUNCH READINESS STATUS: FAILED INTEGRITY CHECK!");
    process.exit(1);
  } else {
    console.log("🚀 LAUNCH READINESS STATUS: VERIFIED (READY FOR PRODUCTION)!");
  }
}

main()
  .catch((err) => {
    console.error("Verification script failed unexpectedly:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
