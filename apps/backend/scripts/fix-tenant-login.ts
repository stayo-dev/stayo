/**
 * Fix login blocks and tenant status issues using Prisma ORM.
 *
 * Modes (set via CLI arg):
 *   list   — show all accounts still blocked by password_reset_required
 *   clear  — clear password_reset_required for ALL blocked accounts
 *   fix    — clear flag + set tenant ACTIVE for a specific email
 *             (set TARGET_EMAIL below or pass as second arg)
 *
 * Run:
 *   npx tsx scripts/fix-tenant-login.ts list
 *   npx tsx scripts/fix-tenant-login.ts clear
 *   npx tsx scripts/fix-tenant-login.ts fix 24311a6610@aiml.sreenidhi.edu.in
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const [, , mode = "fix", emailArg] = process.argv;
const TARGET_EMAIL = emailArg || "24311a6610@aiml.sreenidhi.edu.in";

async function listBlocked() {
  const blocked = await prisma.profile.findMany({
    where: { password_reset_required: true },
    select: {
      id: true,
      email: true,
      phone: true,
      role: true,
      is_active: true,
      tenants: { select: { id: true, status: true } },
    },
  });

  if (blocked.length === 0) {
    console.log("[list] No accounts are blocked by password_reset_required.");
    return;
  }

  console.log(`[list] ${blocked.length} account(s) blocked:\n`);
  for (const p of blocked) {
    console.log(`  email : ${p.email ?? "(none)"}`);
    console.log(`  phone : ${p.phone ?? "(none)"}`);
    console.log(`  role  : ${p.role}`);
    console.log(`  tenant: ${p.tenants ? `id=${p.tenants.id} status=${p.tenants.status}` : "none"}`);
    console.log("");
  }
}

async function clearAll() {
  const result = await prisma.profile.updateMany({
    where: { password_reset_required: true },
    data: {
      password_reset_required: false,
      password_reset_at: new Date(),
    },
  });
  console.log(`[clear] ✅ Cleared password_reset_required on ${result.count} profile(s).`);
}

async function fixOne(email: string) {
  console.log(`[fix] Target: ${email}`);

  const profile = await prisma.profile.findUnique({
    where: { email: email.trim().toLowerCase() },
    select: {
      id: true,
      role: true,
      is_active: true,
      password_reset_required: true,
      tenants: { select: { id: true, status: true } },
    },
  });

  if (!profile) {
    console.error(`[fix] No profile found for "${email}"`);
    process.exit(1);
  }

  console.log("[fix] Profile:", {
    role: profile.role,
    is_active: profile.is_active,
    password_reset_required: profile.password_reset_required,
    tenant_status: profile.tenants?.status ?? "no tenant record",
  });

  if (profile.password_reset_required) {
    await prisma.profile.update({
      where: { id: profile.id },
      data: { password_reset_required: false, password_reset_at: new Date() },
    });
    console.log("[fix] ✅ Cleared password_reset_required");
  } else {
    console.log("[fix] ℹ️  password_reset_required was already false — no change needed");
  }

  if (!profile.tenants) {
    console.error("[fix] No tenant record linked to this profile");
    process.exit(1);
  }

  const prevStatus = profile.tenants.status;
  await prisma.tenants.update({
    where: { id: profile.tenants.id },
    data: { status: "ACTIVE" },
  });
  console.log(`[fix] ✅ Tenant status: ${prevStatus} → ACTIVE`);
  console.log("[fix] Done. The tenant can now log in.");
}

async function main() {
  switch (mode) {
    case "list":  await listBlocked(); break;
    case "clear": await clearAll();    break;
    case "fix":   await fixOne(TARGET_EMAIL); break;
    default:
      console.error(`Unknown mode "${mode}". Use: list | clear | fix`);
      process.exit(1);
  }
}

main()
  .catch((e) => { console.error("[fix-tenant-login] Fatal:", e); process.exit(1); })
  .finally(() => prisma.$disconnect());
