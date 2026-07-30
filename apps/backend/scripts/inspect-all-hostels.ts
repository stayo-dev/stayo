import { prisma } from "../lib/db";

async function main() {
  try {
    console.log("Listing all hostels in the database...");
    const hostels = await prisma.hostels.findMany({
      include: {
        _count: {
          select: {
            rooms: true,
            tenants: true,
            room_allocations: true,
          }
        }
      }
    });
    
    console.log(`\nFound ${hostels.length} hostels:`);
    hostels.forEach(h => {
      console.log(`- ID: ${h.id}`);
      console.log(`  Name: "${h.name}"`);
      console.log(`  Rooms Count: ${h._count.rooms}`);
      console.log(`  Tenants Count: ${h._count.tenants}`);
      console.log(`  Room Allocations Count: ${h._count.room_allocations}`);
      console.log(`  Owner ID: ${h.owner_id}`);
      console.log(`-----------------------------------`);
    });
  } catch (err: any) {
    console.error("Error during inspection:", err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
