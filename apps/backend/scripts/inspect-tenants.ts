import { prisma } from "../lib/db";

async function main() {
  try {
    const ownerId = 'c39676a0-c867-4435-9660-a060b8bceab6';
    const hostels = await prisma.hostels.findMany({
      where: { owner_id: ownerId }
    });
    console.log(`\n=== HOSTELS & TENANTS ===`);
    for (const h of hostels) {
      const activeTenants = await prisma.tenants.findMany({
        where: { hostel_id: h.id, status: 'ACTIVE' }
      });
      const invitedTenants = await prisma.tenants.findMany({
        where: { hostel_id: h.id, status: 'INVITED' }
      });
      const totalTenants = await prisma.tenants.findMany({
        where: { hostel_id: h.id }
      });
      console.log(`Hostel "${h.name}" (ID: ${h.id}):`);
      console.log(`  Active: ${activeTenants.length}`);
      console.log(`  Invited: ${invitedTenants.length}`);
      console.log(`  Total: ${totalTenants.length}`);
    }
  } catch (err: any) {
    console.error("Error:", err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
