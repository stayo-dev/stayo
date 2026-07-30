import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("Fetching exit_settlement_transactions records...");
  const records = await prisma.exit_settlement_transactions.findMany({
    take: 20
  });
  console.log("Found", records.length, "records");
  console.log(JSON.stringify(records, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
