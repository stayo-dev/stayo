import { prisma } from "../lib/db";

async function main() {
  const profiles = await prisma.profile.findMany({ take: 5 });
  console.log("Profiles in DB:", profiles.map(p => ({ id: p.id, email: p.email, role: p.role, name: p.name })));
}

main().catch(console.error).finally(() => prisma.$disconnect());
