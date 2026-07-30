import { prisma } from "../lib/db";

async function main() {
  try {
    const invites = await prisma.tenant_invitations.findMany({
      orderBy: { created_at: 'desc' },
      take: 5
    });
    console.log("=== LATEST TENANT INVITATIONS ===");
    console.log(invites.map(i => ({
      id: i.id,
      email: i.email,
      phone: i.phone,
      token: i.token,
      status: i.status,
      created_at: i.created_at
    })));
  } catch (err: any) {
    console.error("Error:", err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
