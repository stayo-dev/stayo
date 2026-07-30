import { prisma } from "../lib/db";

async function main() {
  try {
    const rooms = await prisma.rooms.findMany({
      where: { hostel_id: "6fa62eca-cbb1-4b12-8567-81756608ed38" }
    });
    console.log(`Rooms for Sri Adithya Boys Hostel-1:`);
    rooms.forEach(r => {
      console.log(`- Room No: ${r.room_no}, Capacity: ${r.capacity}, Active: ${r.is_active}`);
    });
  } catch (err: any) {
    console.error("Error during rooms inspection:", err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
