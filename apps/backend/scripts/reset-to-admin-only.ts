import { prisma } from "../lib/db";

/**
 * Wipe every owner and tenant, keeping platform administrators.
 *
 * Written for a testing phase in which the canonical production project is
 * being used as the test bed. It is deliberately far more destructive than
 * `production-reset-keep-owner.ts`, which preserves owners, hostels, rooms and
 * agreement templates — this one removes all of that too. Nothing survives but
 * ADMIN profiles and the platform-level configuration listed below.
 *
 * THREE RAILS, all required, because this cannot be undone:
 *   1. `--apply`. Without it the script only reports what it would delete.
 *   2. `HMS_RESET_CONFIRMATION` must equal the target project ref.
 *   3. The live `DATABASE_URL` must actually resolve to that project ref —
 *      checked against the connection, not against what a variable claims.
 *
 * Rail 3 exists because the ref lives in the pooler username; a `.env` pointed
 * somewhere unexpected is exactly how the wrong database gets wiped.
 *
 * NOT handled here: Supabase `auth.users`. Deleting a `profiles` row does not
 * delete the auth identity behind it, so previously-registered owners and
 * tenants can still authenticate and will land with no profile. Clear them in
 * the Supabase dashboard (Authentication → Users) or via the admin API.
 */

const APPLY = process.argv.includes("--apply");
const TARGET_REF = "xhoqkhwsnqfwhjsffybs";
const CONFIRMATION = process.env.HMS_RESET_CONFIRMATION;

/** Platform-level rows that are not owner or tenant data. */
const PRESERVED_TABLES = [
  "_prisma_migrations",
  "profiles", // handled manually: ADMIN rows survive
  "system_locks",
  "message_packs",
];

function quoteIdent(identifier: string) {
  return `"${identifier.replace(/"/g, '""')}"`;
}

async function resolveLiveProjectRef(): Promise<string | null> {
  const rows: any = await prisma.$queryRawUnsafe("select current_user as who");
  const match = /postgres\.([a-z0-9]{20})/.exec(rows[0]?.who ?? "");
  return match?.[1] ?? null;
}

async function tablesToClear(): Promise<string[]> {
  const rows: any = await prisma.$queryRawUnsafe(
    `select tablename from pg_tables
      where schemaname = 'public'
        and tablename not in (${PRESERVED_TABLES.map((_, i) => `$${i + 1}`).join(", ")})
      order by tablename`,
    ...PRESERVED_TABLES
  );
  return rows.map((r: any) => r.tablename);
}

async function main() {
  const liveRef = await resolveLiveProjectRef();
  const [{ admins }]: any = await prisma.$queryRawUnsafe("select count(*)::bigint as admins from profiles where role = 'ADMIN'");
  const [{ doomed }]: any = await prisma.$queryRawUnsafe("select count(*)::bigint as doomed from profiles where role <> 'ADMIN'");
  const tables = await tablesToClear();

  console.log(JSON.stringify({
    mode: APPLY ? "APPLY" : "DRY RUN",
    live_project_ref: liveRef,
    target_project_ref: TARGET_REF,
    admin_profiles_kept: Number(admins),
    profiles_to_delete: Number(doomed),
    tables_to_truncate: tables.length,
    apply_command: `HMS_RESET_CONFIRMATION=${TARGET_REF} npx tsx scripts/reset-to-admin-only.ts --apply`,
  }, null, 2));

  if (Number(admins) === 0) {
    console.error("❌ Refusing: no ADMIN profile exists, so this would leave the platform with no way in.");
    process.exit(1);
  }
  if (!APPLY) {
    console.log("\nDry run only. Nothing was deleted.");
    return;
  }
  if (CONFIRMATION !== TARGET_REF) {
    console.error(`❌ Refusing: HMS_RESET_CONFIRMATION must equal '${TARGET_REF}'.`);
    process.exit(1);
  }
  if (liveRef !== TARGET_REF) {
    console.error(`❌ Refusing: DATABASE_URL resolves to '${liveRef}', not '${TARGET_REF}'.`);
    process.exit(1);
  }

  // One statement: TRUNCATE ... CASCADE across every non-preserved table at
  // once, so foreign keys never have to be satisfied in a particular order.
  const list = tables.map(quoteIdent).join(", ");
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
  const removed = await prisma.$executeRawUnsafe(
    "DELETE FROM profiles WHERE role <> 'ADMIN'"
  );

  console.log(JSON.stringify({
    truncated_tables: tables.length,
    profiles_deleted: removed,
    admin_profiles_remaining: Number(admins),
    reminder: "Supabase auth.users is NOT touched — clear it in the dashboard, or old logins will resolve to no profile.",
  }, null, 2));
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
