import { prisma } from "@/lib/db";
import { propertyService } from "@/lib/services/property-service";

async function run() {
  try {
    const hostel = await prisma.hostels.findUnique({
      where: { id: "79ba709b-fc27-42bd-9d7b-02bac79431b5" }
    });
    if (!hostel) {
        console.log("hostel not found in local db");
        return;
    }
    
    console.log(`Testing hostel: ${hostel.id}, owner: ${hostel.owner_id}`);
    const floors = await propertyService.getFloorsWithRooms(hostel.owner_id, hostel.id);
    console.log("Success! Floors length:", floors.length);
  } catch (error) {
    console.error("ERROR:");
    console.error(error);
  } finally {
    await prisma.$disconnect();
  }
}
run();
