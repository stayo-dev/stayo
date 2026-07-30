import { prisma } from "../lib/db";

async function main() {
  try {
    const ownerId = 'c39676a0-c867-4435-9660-a060b8bceab6';
    const hostels = await prisma.hostels.findMany({
      where: { owner_id: ownerId }
    });
    console.log(`\n=== HOSTELS (${hostels.length}) ===`);
    for (const h of hostels) {
      console.log(`- ID: ${h.id}, Name: "${h.name}", IsActive: ${h.is_active}`);
      const rooms = await prisma.rooms.findMany({
        where: { hostel_id: h.id }
      });
      console.log(`  Rooms count: ${rooms.length}`);
      for (const r of rooms) {
        const allocations = await prisma.roomAllocation.findMany({
          where: { room_id: r.id, is_active: true }
        });
        console.log(`    Room "${r.room_no}": capacity = ${r.capacity}, active allocations = ${allocations.length}`);
      }
    }
  } catch (err: any) {
    console.error("Error:", err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
