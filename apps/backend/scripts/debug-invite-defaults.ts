import { prisma } from "../lib/db";
import { hostelBillingPreferencesService } from "../lib/services/hostel-billing-preferences-service";

async function main() {
  try {
    // 1. Get some rooms
    const rooms = await prisma.rooms.findMany({
      take: 5,
      include: {
        hostels: true
      }
    });

    console.log(`Found ${rooms.length} rooms.`);
    for (const r of rooms) {
      console.log(`Room ID: ${r.id}, Room No: ${r.room_no}, Hostel ID: ${r.hostel_id}, Owner ID: ${r.hostels?.owner_id}`);
      
      if (r.hostels?.owner_id) {
        try {
          const defaults = await hostelBillingPreferencesService.resolveTenantInviteDefaults(r.id, r.hostels.owner_id);
          console.log(`- Success! Defaults:`, JSON.stringify(defaults, null, 2));
        } catch (err: any) {
          console.error(`- Failed: ${err.message}`);
        }
      }
    }
  } catch (error: any) {
    console.error("Error:", error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
