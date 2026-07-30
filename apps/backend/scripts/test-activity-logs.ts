import { prisma } from "../lib/db";

async function main() {
  try {
    console.log("Querying activity logs count...");
    const count = await prisma.activity_logs.count();
    console.log("Total activity logs in DB:", count);

    console.log("Fetching first 5 logs...");
    const logs = await prisma.activity_logs.findMany({
      take: 5,
    });
    console.log("Logs:", JSON.stringify(logs, null, 2));
  } catch (e) {
    console.error("Prisma query failed:", e);
  } finally {
    await prisma.$disconnect();
  }
}

main();
