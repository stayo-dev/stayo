import { prisma } from "../lib/db";

async function main() {
  try {
    console.log("Starting room capacity sanitization...");
    const rooms = await prisma.rooms.findMany();
    let updatedCount = 0;
    for (const room of rooms) {
      if (typeof room.capacity !== 'number' || isNaN(room.capacity) || room.capacity < 0) {
        console.log(`Fixing room ${room.id} (${room.room_no}) capacity: current = ${room.capacity}`);
        await prisma.rooms.update({
          where: { id: room.id },
          data: { capacity: Math.max(0, Number(room.capacity || 0)) }
        });
        updatedCount++;
      }
    }
    console.log(`Sanitization complete. Fixed ${updatedCount} rooms.`);
  } catch (err: any) {
    console.error("Error during sanitization:", err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
