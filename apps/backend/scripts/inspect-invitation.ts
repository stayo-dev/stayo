import { prisma } from "../lib/db";

async function main() {
  const invitation = await prisma.tenant_invitations.findFirst({
    where: { tenant_id: "aa0f80e7-4a2f-413c-b98d-4c5a0927d539" }
  });
  console.log(JSON.stringify(invitation, null, 2));
}

main().finally(() => prisma.$disconnect());
