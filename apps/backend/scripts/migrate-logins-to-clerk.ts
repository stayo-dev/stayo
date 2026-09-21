/**
 * Move every existing account onto Clerk (ADR-204, rollout step 3).
 *
 * Clerk is the only authentication provider. Accounts created before the
 * cutover have a bcrypt hash in `profiles.password_hash` and (usually) a
 * Supabase Auth identity. This script gives each such profile a Clerk login
 * WITHOUT a password reset, by importing the bcrypt digest itself — Clerk
 * verifies bcrypt natively (`passwordHasher: "bcrypt"`), so the person's
 * existing password keeps working. It links by id: the Clerk user gets
 * `externalId = profiles.id`, and `users` gets `(clerk_user_id, profile_id)`.
 * It never matches anyone by email.
 *
 * The same move also happens one account at a time on each sign-in
 * (`credentialService.migrateOnSignIn`); this script is the bulk, planned
 * path, so the Supabase-auth branch can be deleted on a date rather than
 * whenever the last person happens to log in.
 *
 * Dry run by default. Every write needs --apply.
 *
 *   npm run migrate:logins-to-clerk                  # report only
 *   npm run migrate:logins-to-clerk -- --apply       # create + link
 *
 * What it reports, per profile:
 *   ALREADY_LINKED        has a `users` row — nothing to do (its link is
 *                         then checked, see LINK_UNVERIFIED)
 *   CREATE_WITH_DIGEST    will get a Clerk user with its bcrypt hash imported
 *   CREATE_NO_PASSWORD    has no usable hash (e.g. Google-only): gets a Clerk
 *                         user without a password; signs in with Google or
 *                         resets
 *   ADOPT_BY_EXTERNAL_ID  a Clerk user with this externalId already exists
 *                         (an interrupted earlier run) — will be linked
 *   CONFLICT_EMAIL_TAKEN  Clerk already holds this email on a user that is
 *                         NOT ours (typically a Google sign-in). Never adopted
 *                         automatically: a human confirms it is the same
 *                         person, then sets that Clerk user's externalId to
 *                         the profile id in the Clerk dashboard; the
 *                         `user.updated` webhook then links it.
 *   LINK_UNVERIFIED       a `users` row linked before ADR-204 (the old
 *                         webhook linked by email) whose Clerk user does not
 *                         carry externalId = profile id. Reported for review;
 *                         never changed by this script.
 */
import * as dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

const BCRYPT_RE = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;
const PLACEHOLDER_SUFFIX = "@hms.temp";

type Outcome =
  | "ALREADY_LINKED"
  | "CREATE_WITH_DIGEST"
  | "CREATE_NO_PASSWORD"
  | "ADOPT_BY_EXTERNAL_ID"
  | "CONFLICT_EMAIL_TAKEN"
  | "LINK_UNVERIFIED";

async function main() {
  const apply = process.argv.includes("--apply");
  const { prisma } = await import("../lib/db");
  const { getClerkBackend } = await import("../lib/auth/clerk-backend");
  const clerk = getClerkBackend() as any;

  const profiles: Array<{
    id: string;
    email: string;
    role: string;
    is_active: boolean;
    password_hash: string | null;
    login: { clerk_user_id: string } | null;
  }> = await prisma.profile.findMany({
    select: { id: true, email: true, role: true, is_active: true, password_hash: true, login: { select: { clerk_user_id: true } } },
    orderBy: [{ role: "asc" }, { email: "asc" }],
  });

  const tally = new Map<Outcome, number>();
  const note = (o: Outcome, p: { id: string; email: string; role: string }, extra = "") => {
    tally.set(o, (tally.get(o) ?? 0) + 1);
    console.log(`${o.padEnd(22)} ${p.role.padEnd(7)} ${p.id} ${p.email}${extra ? `  ${extra}` : ""}`);
  };

  for (const p of profiles) {
    if (p.login) {
      const user = await clerk.users.getUser?.(p.login.clerk_user_id).catch(() => null);
      if (user && user.externalId !== p.id) {
        note("LINK_UNVERIFIED", p, `clerk=${p.login.clerk_user_id} externalId=${user.externalId ?? "∅"}`);
      } else {
        note("ALREADY_LINKED", p);
      }
      continue;
    }

    const email = p.email.toLowerCase().endsWith(PLACEHOLDER_SUFFIX) ? null : p.email.toLowerCase();

    const byExternalId = await clerk.users.getUserList({ externalId: [p.id], limit: 2 });
    let clerkUserId: string | null = byExternalId.data.find((u: any) => u.externalId === p.id)?.id ?? null;
    if (clerkUserId) {
      note("ADOPT_BY_EXTERNAL_ID", p, `clerk=${clerkUserId}`);
    } else if (email) {
      const byEmail = await clerk.users.getUserList({ emailAddress: [email], limit: 2 });
      if (byEmail.data.length > 0) {
        note("CONFLICT_EMAIL_TAKEN", p, `clerk=${byEmail.data.map((u: any) => u.id).join(",")} — needs human review`);
        continue;
      }
    }

    const digest = p.password_hash && BCRYPT_RE.test(p.password_hash) ? p.password_hash : null;
    if (!clerkUserId) note(digest ? "CREATE_WITH_DIGEST" : "CREATE_NO_PASSWORD", p);
    if (!apply) continue;

    if (!clerkUserId) {
      const created = await clerk.users.createUser({
        externalId: p.id,
        ...(email ? { emailAddress: [email] } : {}),
        ...(digest ? { passwordDigest: digest, passwordHasher: "bcrypt" } : { skipPasswordRequirement: true }),
        skipLegalChecks: true,
      });
      clerkUserId = created.id;
    }

    await prisma.users.create({ data: { clerk_user_id: clerkUserId, profile_id: p.id, email } });
    // The digest now lives in Clerk; ours is retired. From here on this
    // profile's Supabase and legacy sessions are refused by getSession().
    await prisma.profile.update({ where: { id: p.id }, data: { password_hash: null } });
  }

  console.log("\nSummary:");
  tally.forEach((n, o) => console.log(`  ${o.padEnd(22)} ${n}`));
  console.log(apply ? "\nApplied." : "\nDry run — nothing written. Re-run with --apply.");
  await prisma.$disconnect?.();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
