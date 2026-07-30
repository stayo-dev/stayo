/**
 * Supabase Auth identity reconciliation (ADR-031).
 *
 * There is no flag anywhere recording which `profiles` rows already have a
 * real Supabase `auth.users` counterpart — the old signup code's intent was
 * `profiles.id === auth.users.id`, but it silently fell back to a local
 * UUID on any Supabase failure, so that's never been a guarantee. This
 * script cross-references `profiles` against `auth.users` (same Postgres
 * instance) by both `id` and `email`, classifies every row, and — only
 * with --apply — links the unambiguous cases. It never creates a Supabase
 * user and never touches a password; provisioning belongs to the
 * just-in-time path in lib/auth/supabase-identity.ts, which has a
 * plaintext password in hand. This script only links what's already there.
 *
 * Usage:
 *   npx tsx scripts/reconcile-supabase-identities.ts            # dry run (default)
 *   npx tsx scripts/reconcile-supabase-identities.ts --apply     # write links
 */
import * as dotenv from "dotenv";
import path from "path";
const envPath = path.resolve(__dirname, "../../../.env");
dotenv.config({ path: envPath });

interface Row {
  id: string;
  email: string;
  role: string;
  auth_user_id: string | null;
  auth_user_id_exists: string | null;
  auth_match_by_id: string | null;
  auth_match_by_email: string | null;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const { prisma } = await import("../lib/db");

  const rows = await prisma.$queryRaw<Row[]>`
    SELECT
      p.id, p.email, p.role, p.auth_user_id::text AS auth_user_id,
      u_by_auth_user_id.id::text AS auth_user_id_exists,
      u_by_id.id::text    AS auth_match_by_id,
      u_by_email.id::text AS auth_match_by_email
    FROM profiles p
    LEFT JOIN auth.users u_by_auth_user_id ON u_by_auth_user_id.id = p.auth_user_id
    LEFT JOIN auth.users u_by_id    ON u_by_id.id = p.id
    LEFT JOIN auth.users u_by_email ON lower(u_by_email.email) = lower(p.email)
    ORDER BY p.role, p.email
  `;

  // Detect any email matched by more than one profile (shouldn't happen —
  // Supabase enforces email uniqueness on auth.users — but assert it
  // rather than silently linking the wrong one).
  const emailCounts = new Map<string, number>();
  for (const r of rows) {
    if (r.auth_match_by_email) {
      emailCounts.set(r.auth_match_by_email, (emailCounts.get(r.auth_match_by_email) ?? 0) + 1);
    }
  }

  const summary = {
    already_linked: 0,
    linked_id_and_email: [] as Row[],
    linked_email_only: [] as Row[],
    ambiguous_id_only: [] as Row[],
    duplicate_auth_user_match: [] as Row[],
    unlinked_no_match: [] as Row[],
    dangling_auth_user_id: [] as Row[],
  };

  const toLink: Array<{ profileId: string; authUserId: string }> = [];

  for (const r of rows) {
    if (r.auth_user_id) {
      if (!r.auth_user_id_exists) {
        summary.dangling_auth_user_id.push(r); // linked, but the auth.users row no longer exists
      } else {
        summary.already_linked++;
      }
      continue;
    }

    const emailMatchCount = r.auth_match_by_email ? emailCounts.get(r.auth_match_by_email) ?? 0 : 0;
    if (r.auth_match_by_email && emailMatchCount > 1) {
      summary.duplicate_auth_user_match.push(r);
      continue;
    }

    if (r.auth_match_by_id && r.auth_match_by_email && r.auth_match_by_id === r.auth_match_by_email) {
      summary.linked_id_and_email.push(r);
      toLink.push({ profileId: r.id, authUserId: r.auth_match_by_id });
    } else if (r.auth_match_by_id && !r.auth_match_by_email) {
      // profiles.id happens to match an auth.users id, but the emails
      // diverge (e.g. the email was changed in one system but not the
      // other) — needs a human, never auto-link on an id-only match.
      summary.ambiguous_id_only.push(r);
    } else if (r.auth_match_by_email) {
      summary.linked_email_only.push(r);
      toLink.push({ profileId: r.id, authUserId: r.auth_match_by_email });
    } else {
      summary.unlinked_no_match.push(r);
    }
  }

  console.log(`\n=== Supabase identity reconciliation (${apply ? "APPLY" : "DRY RUN"}) ===\n`);

  const byRole = (list: Row[]) => {
    const counts: Record<string, number> = {};
    for (const r of list) counts[r.role] = (counts[r.role] ?? 0) + 1;
    return counts;
  };

  console.log(`Already linked:              ${summary.already_linked}`);
  console.log(`Dangling auth_user_id:       ${summary.dangling_auth_user_id.length}`, byRole(summary.dangling_auth_user_id));
  console.log(`Will link (id + email match):${summary.linked_id_and_email.length}`, byRole(summary.linked_id_and_email));
  console.log(`Will link (email match only):${summary.linked_email_only.length}`, byRole(summary.linked_email_only));
  console.log(`Ambiguous (id match, email diverges — needs a human):`, summary.ambiguous_id_only.length, byRole(summary.ambiguous_id_only));
  console.log(`Duplicate auth.users match for one email (needs a human):`, summary.duplicate_auth_user_match.length);
  console.log(`Unlinked, no Supabase user yet (JIT will handle on next login):`, summary.unlinked_no_match.length, byRole(summary.unlinked_no_match));

  if (summary.ambiguous_id_only.length > 0) {
    console.log("\n--- Ambiguous (id match, email diverges) — review by hand ---");
    for (const r of summary.ambiguous_id_only) console.log(`  ${r.role}\t${r.email}\tprofile=${r.id}`);
  }
  if (summary.dangling_auth_user_id.length > 0) {
    console.log("\n--- Dangling auth_user_id (linked row no longer exists in auth.users) ---");
    for (const r of summary.dangling_auth_user_id) console.log(`  ${r.role}\t${r.email}\tprofile=${r.id}\tauth_user_id=${r.auth_user_id}`);
  }

  if (!apply) {
    console.log(`\n${toLink.length} profiles would be linked. Re-run with --apply to write.`);
    return;
  }

  console.log(`\nLinking ${toLink.length} profiles...`);
  let linked = 0;
  for (const { profileId, authUserId } of toLink) {
    try {
      await prisma.profile.update({
        where: { id: profileId },
        data: { auth_user_id: authUserId, auth_linked_at: new Date() },
      });
      linked++;
    } catch (e: any) {
      console.warn(`  Failed to link ${profileId} -> ${authUserId}: ${e?.message}`);
    }
  }
  console.log(`Linked ${linked}/${toLink.length}.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
