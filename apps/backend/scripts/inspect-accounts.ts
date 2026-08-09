/**
 * Read-only inventory of who can sign in, for local testing.
 *
 * Prints account emails, roles and whether each has a usable password and a
 * linked Supabase identity — plus how many hostels each owner has, since the
 * Configuration screens need at least one hostel to show anything.
 *
 * Run: npm run inspect:accounts
 */
import { prisma } from "../lib/db";

async function main() {
  const profiles = await prisma.$queryRaw<
    Array<{
      id: string;
      email: string;
      name: string;
      role: string;
      is_active: boolean;
      has_password: boolean;
      supabase_linked: boolean;
      password_reset_required: boolean;
      hostels: bigint;
    }>
  >`
    SELECT p.id, p.email, p.name, p.role::text AS role, p.is_active,
           (p.password_hash IS NOT NULL) AS has_password,
           (p.auth_user_id IS NOT NULL) AS supabase_linked,
           p.password_reset_required,
           (SELECT COUNT(*) FROM hostels h WHERE h.owner_id = p.id) AS hostels
    FROM profiles p
    ORDER BY p.role, p.email
  `;

  console.log(`\nAccounts in this database: ${profiles.length}\n`);
  for (const p of profiles) {
    console.log(
      [
        `  ${p.email}`,
        `role=${p.role}`,
        `active=${p.is_active}`,
        `password=${p.has_password}`,
        `supabase_linked=${p.supabase_linked}`,
        `hostels=${Number(p.hostels)}`,
        p.password_reset_required ? "MUST_RESET_PASSWORD" : "",
      ]
        .filter(Boolean)
        .join("  |  "),
    );
  }

  const hostelCount = await prisma.hostels.count();
  console.log(`\nHostels in this database: ${hostelCount}`);
  const loginable = profiles.filter(
    (p) => p.role === "OWNER" && p.is_active && p.has_password && !p.password_reset_required,
  );
  console.log(
    `Owner accounts that can sign in with a password right now: ${loginable.length}` +
      (loginable.length ? ` (${loginable.map((p) => p.email).join(", ")})` : ""),
  );
  console.log(
    `Of those, with at least one hostel (needed for the Configuration screens): ` +
      `${loginable.filter((p) => Number(p.hostels) > 0).length}\n`,
  );
}

main()
  .catch((error) => {
    console.error("inspect failed:", error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
