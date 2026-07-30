import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const result = await prisma.rent_obligations.findMany({
    select: { obligation_type: true },
    distinct: ['obligation_type']
  });
  console.log("Distinct obligation types:", result);
}

main()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect());
