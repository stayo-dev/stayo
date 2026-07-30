import { prisma } from "../lib/db";

async function main() {
  const id1 = "5db1a00d-3cf2-43f9-aa17-db163298392a";
  const id2 = "5db1a00d-3cf2-43f9-aa17-db163290392a";

  const t1 = await prisma.tenants.findUnique({ where: { id: id1 } });
  const t2 = await prisma.tenants.findUnique({ where: { id: id2 } });

  console.log("Tenant with 8:", t1 ? "EXISTS" : "null");
  console.log("Tenant with 0:", t2 ? "EXISTS" : "null");

  const aid1 = "3a016aea-93a2-4a67-9f31-7d60b8b450c6";
  const aid2 = "3a016aea-9ba2-4a67-9f31-7d60b0b450c6";

  const a1 = await prisma.agreement.findUnique({ where: { id: aid1 } });
  const a2 = await prisma.agreement.findUnique({ where: { id: aid2 } });

  console.log("Agreement 1 (8/3):", a1 ? "EXISTS" : "null");
  console.log("Agreement 2 (0/b):", a2 ? "EXISTS" : "null");
}

main()
  .catch((err) => console.error(err))
  .finally(() => prisma.$disconnect());
