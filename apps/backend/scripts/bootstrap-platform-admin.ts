/**
 * One-time bootstrap for the first platform admin account. Platform admins
 * have no public self-serve signup (security-sensitive, same posture as the
 * owner bootstrap's ALLOW_OWNER_BOOTSTRAP gate) — the first one is created
 * here; later ones are invited via the Admin Users panel (/admin/settings)
 * by an existing admin.
 *
 * Usage: npx tsx scripts/bootstrap-platform-admin.ts <email> <password> <name>
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import crypto from "crypto";

const prisma = new PrismaClient();

async function main() {
  const [email, password, name] = process.argv.slice(2);
  if (!email || !password || !name) {
    console.error("Usage: npx tsx scripts/bootstrap-platform-admin.ts <email> <password> <name>");
    process.exit(1);
  }

  const existing = await prisma.profile.findUnique({ where: { email } });
  if (existing) {
    if (existing.role !== "ADMIN") {
      console.error(`A profile with email ${email} already exists with role ${existing.role}`);
      process.exit(1);
    }
    console.log(`Profile ${email} already exists as ADMIN — no changes made.`);
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const profile = await prisma.profile.create({
    data: {
      id: crypto.randomUUID(),
      email,
      name,
      password_hash: passwordHash,
      role: "ADMIN",
      is_profile_completed: true,
    },
  });

  await prisma.platform_admins.create({
    data: { profile_id: profile.id, title: "OWNER" },
  });

  console.log(`Created platform admin ${email} (${profile.id})`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
