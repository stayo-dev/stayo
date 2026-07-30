import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient({
  log: ["query", "info", "warn", "error"]
});

async function main() {
  try {
    const latestInvitation = await prisma.tenant_invitations.findFirst({
      orderBy: {
        created_at: 'desc'
      }
    });
    console.log("Latest Invitation details:", JSON.stringify(latestInvitation, null, 2));
  } catch (error) {
    console.error("Error in test-query:", error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
