import { prisma, supabase } from "../lib/db";

/**
 * Deletes every Supabase auth.users identity except the one matching
 * KEEP_EMAIL. Companion to reset-to-admin-only.ts, which wipes every
 * Postgres table but explicitly does not (cannot) touch auth.users — that
 * schema is Supabase-managed, out of reach of a Postgres TRUNCATE. Kept as
 * its own script rather than folded into that one: this needs the Supabase
 * Admin API, not Postgres, and deleting the one identity meant to survive
 * is a different, narrower risk worth its own explicit gate.
 *
 * THREE RAILS, all required, same shape as reset-to-admin-only.ts:
 *   1. --apply. Without it, this only reports what it would delete.
 *   2. HMS_RESET_CONFIRMATION must equal the target project ref.
 *   3. The live DATABASE_URL must actually resolve to that project ref.
 *
 * Plus a fourth, specific to this script: refuses if no auth user matches
 * KEEP_EMAIL — deleting every identity would otherwise lock out the admin
 * this whole reset is meant to leave standing.
 *
 * Usage: KEEP_EMAIL=admin@yourstayo.com HMS_RESET_CONFIRMATION=<ref> \
 *   npx tsx scripts/clear-auth-except-admin.ts --apply
 */

const APPLY = process.argv.includes("--apply");
const TARGET_REF = "xhoqkhwsnqfwhjsffybs";
const CONFIRMATION = process.env.HMS_RESET_CONFIRMATION;
const KEEP_EMAIL = process.env.KEEP_EMAIL;

async function resolveLiveProjectRef(): Promise<string | null> {
  // Same fix as reset-to-admin-only.ts's resolveLiveProjectRef: Supabase's
  // Supavisor pooler authenticates on `postgres.<ref>` but reports the actual
  // session's `current_user` as bare `postgres`, so querying it can never
  // confirm anything here. Parse the ref straight out of the exact
  // `DATABASE_URL` lib/db.ts hands to PrismaClient instead.
  const match = /postgres\.([a-z0-9]{20})/.exec(process.env.DATABASE_URL ?? "");
  return match?.[1] ?? null;
}

async function listAllUsers(): Promise<{ id: string; email: string | null }[]> {
  const all: { id: string; email: string | null }[] = [];
  const perPage = 200;
  let page = 1;
  // Supabase paginates listUsers; loop until a short page signals the end.
  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    all.push(...data.users.map((u) => ({ id: u.id, email: u.email ?? null })));
    if (data.users.length < perPage) break;
    page++;
  }
  return all;
}

async function main() {
  if (!KEEP_EMAIL) {
    console.error("❌ Refusing: KEEP_EMAIL env var is required (the one identity to keep).");
    process.exit(1);
  }

  const liveRef = await resolveLiveProjectRef();
  const users = await listAllUsers();
  const survivor = users.find((u) => u.email?.toLowerCase() === KEEP_EMAIL.toLowerCase());
  const toDelete = users.filter((u) => u.email?.toLowerCase() !== KEEP_EMAIL.toLowerCase());

  console.log(JSON.stringify({
    mode: APPLY ? "APPLY" : "DRY RUN",
    live_project_ref: liveRef,
    target_project_ref: TARGET_REF,
    keep_email: KEEP_EMAIL,
    survivor_found: Boolean(survivor),
    total_auth_users: users.length,
    users_to_delete: toDelete.length,
    apply_command: `KEEP_EMAIL=${KEEP_EMAIL} HMS_RESET_CONFIRMATION=${TARGET_REF} npx tsx scripts/clear-auth-except-admin.ts --apply`,
  }, null, 2));

  if (!survivor) {
    console.error(`❌ Refusing: no auth.users identity matches KEEP_EMAIL '${KEEP_EMAIL}' — deleting everyone would lock out the admin too.`);
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

  let deleted = 0;
  const failures: { id: string; email: string | null; error: string }[] = [];
  for (const u of toDelete) {
    const { error } = await supabase.auth.admin.deleteUser(u.id);
    if (error) {
      failures.push({ id: u.id, email: u.email, error: error.message });
      continue;
    }
    deleted++;
  }

  console.log(JSON.stringify({
    deleted,
    kept: KEEP_EMAIL,
    failures,
  }, null, 2));
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
