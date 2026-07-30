import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const count = await prisma.exit_settlement_transactions.count();
  console.log("Total rows in exit_settlement_transactions:", count);
  if (count > 0) {
    const rows = await prisma.exit_settlement_transactions.findMany({ take: 50 });
    console.log("Rows data:", JSON.stringify(rows, null, 2));
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
