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
 * INCIDENT (2026-08-29): a first run of this script wiped `profiles` —
 * including every ADMIN row — despite it being listed in `PRESERVED_TABLES`.
 * `profiles.import_batch_id` has a foreign key to `bulk_import_batches`, which
 * *was* being truncated; `TRUNCATE ... CASCADE` reaches through that FK
 * regardless of whether the referencing table was in the truncate statement's
 * own table list. Listing a table as "preserved" only keeps it out of the
 * TRUNCATE list — it says nothing about whether CASCADE can still reach it
 * through a column pointing at something that *is* being truncated. Fixed by
 * `preservedTableCascadeHazards()` below: before truncating, it discovers
 * every such FK dynamically (so a future column addition can't silently
 * reopen this) and nulls it out first, breaking the link a preserved row
 * would otherwise be dragged through. The admin profile lost in that incident
 * was recovered manually (its Supabase auth identity was untouched — this
 * script never reaches `auth.users` — so the `profiles` row could be
 * recreated and relinked); no backup existed, so this fix is the real
 * safeguard, not a formality.
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
  // Originally queried `current_user`, expecting the pooler-auth username
  // (`postgres.<ref>`) to echo back verbatim. It doesn't: Supabase's Supavisor
  // pooler authenticates on that username but reports the actual Postgres
  // session's `current_user` as bare `postgres`, so that query always
  // returned null here — never confirming anything, on any project. The ref
  // is still reliably present in the exact `DATABASE_URL` lib/db.ts hands to
  // PrismaClient as `datasourceUrl`; parse that instead — it's the real
  // string driving this live connection, not a separate variable that could
  // disagree with it.
  const match = /postgres\.([a-z0-9]{20})/.exec(process.env.DATABASE_URL ?? "");
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

/**
 * Every foreign-key column on a *preserved* table that points at a table
 * being truncated — discovered from Postgres's own constraint metadata, not
 * hand-maintained, so a future column addition can't quietly reopen this.
 * `TRUNCATE ... CASCADE` reaches through these regardless of the exclusion
 * list (see the INCIDENT note above); nulling them first breaks the link a
 * preserved row would otherwise be dragged through, without touching any
 * other column on that row.
 */
async function preservedTableCascadeHazards(): Promise<{ table: string; column: string; references: string }[]> {
  const rows: any = await prisma.$queryRawUnsafe(
    `select tc.table_name as referencing_table, kcu.column_name as referencing_column, ccu.table_name as referenced_table
       from information_schema.table_constraints tc
       join information_schema.key_column_usage kcu
         on tc.constraint_name = kcu.constraint_name and tc.table_schema = kcu.table_schema
       join information_schema.constraint_column_usage ccu
         on tc.constraint_name = ccu.constraint_name and tc.table_schema = ccu.table_schema
      where tc.constraint_type = 'FOREIGN KEY'
        and tc.table_schema = 'public'
        and tc.table_name in (${PRESERVED_TABLES.map((_, i) => `$${i + 1}`).join(", ")})`,
    ...PRESERVED_TABLES
  );
  return rows
    .filter((r: any) => !PRESERVED_TABLES.includes(r.referenced_table))
    .map((r: any) => ({ table: r.referencing_table, column: r.referencing_column, references: r.referenced_table }));
}

async function main() {
  const liveRef = await resolveLiveProjectRef();
  const [{ admins }]: any = await prisma.$queryRawUnsafe("select count(*)::bigint as admins from profiles where role = 'ADMIN'");
  const [{ doomed }]: any = await prisma.$queryRawUnsafe("select count(*)::bigint as doomed from profiles where role <> 'ADMIN'");
  const tables = await tablesToClear();
  const hazards = await preservedTableCascadeHazards();

  console.log(JSON.stringify({
    mode: APPLY ? "APPLY" : "DRY RUN",
    live_project_ref: liveRef,
    target_project_ref: TARGET_REF,
    admin_profiles_kept: Number(admins),
    profiles_to_delete: Number(doomed),
    tables_to_truncate: tables.length,
    cascade_hazards_to_clear_first: hazards,
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

  // Break every CASCADE hazard first — a preserved table is only actually
  // safe from TRUNCATE ... CASCADE once nothing on it still points at a
  // table about to be truncated. See the INCIDENT note above.
  for (const hazard of hazards) {
    await prisma.$executeRawUnsafe(
      `UPDATE ${quoteIdent(hazard.table)} SET ${quoteIdent(hazard.column)} = NULL WHERE ${quoteIdent(hazard.column)} IS NOT NULL`
    );
  }

  // One statement: TRUNCATE ... CASCADE across every non-preserved table at
  // once, so foreign keys never have to be satisfied in a particular order.
  const list = tables.map(quoteIdent).join(", ");
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
  const removed = await prisma.$executeRawUnsafe(
    "DELETE FROM profiles WHERE role <> 'ADMIN'"
  );

  console.log(JSON.stringify({
    cascade_hazards_cleared: hazards.length,
    truncated_tables: tables.length,
    profiles_deleted: removed,
    admin_profiles_remaining: Number(admins),
    reminder: "Supabase auth.users is NOT touched — clear it in the dashboard, or old logins will resolve to no profile.",
  }, null, 2));
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
