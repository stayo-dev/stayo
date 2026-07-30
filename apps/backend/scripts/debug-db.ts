import { prisma } from "../lib/db";

async function main() {
  const owners = await prisma.profile.findMany({
    where: { role: "OWNER" },
    select: { id: true, email: true, phone: true, name: true }
  });
  console.log("Owners:", JSON.stringify(owners, null, 2));

  const tenants = await prisma.profile.findMany({
    where: { role: "TENANT" },
    select: { id: true, email: true, phone: true, name: true },
    take: 10
  });
  console.log("Tenants:", JSON.stringify(tenants, null, 2));
}

main().catch(console.error);
