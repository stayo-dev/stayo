import { prisma } from "../lib/db";

async function main() {
  try {
    const hostelsCount = await prisma.hostels.count();
    const roomsCount = await prisma.rooms.count();
    const roomAllocationCount = await prisma.roomAllocation.count();
    const tenantsCount = await prisma.tenants.count();
    const profilesCount = await prisma.profile.count();
    
    console.log(`\n=== DATABASE COUNTS ===`);
    console.log(`Hostels: ${hostelsCount}`);
    console.log(`Rooms: ${roomsCount}`);
    console.log(`Room Allocations: ${roomAllocationCount}`);
    console.log(`Tenants: ${tenantsCount}`);
    console.log(`Profiles: ${profilesCount}`);
  } catch (err: any) {
    console.error("Error:", err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
