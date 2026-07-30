import { prisma } from "../lib/db";

async function main() {
  try {
    const duplicates = ["2b2ca988-72cf-42b4-956e-e0338457dd5c", "cb2183db-e463-4e48-8d90-17c6f33026c0"];
    
    for (const id of duplicates) {
      console.log(`\nChecking dependencies for hostel ${id}...`);
      
      const [
        rooms, tenants, allocations, rentObs, payments, expenses, 
        agreements, invitations, snapshots
      ] = await Promise.all([
        prisma.rooms.count({ where: { hostel_id: id } }),
        prisma.tenants.count({ where: { hostel_id: id } }),
        prisma.roomAllocation.count({ where: { hostel_id: id } }),
        prisma.rent_obligations.count({ where: { hostel_id: id } }),
        prisma.payments.count({ where: { hostel_id: id } }),
        prisma.expenses.count({ where: { hostel_id: id } }),
        prisma.agreement.count({ where: { hostel_id: id } }),
        prisma.tenant_invitations.count({ where: { hostel_id: id } }),
        (prisma as any).hostelDailySnapshot.count({ where: { hostel_id: id } }),
      ]);
      
      console.log(`- Rooms: ${rooms}`);
      console.log(`- Tenants: ${tenants}`);
      console.log(`- Allocations: ${allocations}`);
      console.log(`- Rent Obligations: ${rentObs}`);
      console.log(`- Payments: ${payments}`);
      console.log(`- Expenses: ${expenses}`);
      console.log(`- Agreements: ${agreements}`);
      console.log(`- Invitations: ${invitations}`);
      console.log(`- Snapshots: ${snapshots}`);
      
      if (rooms === 0 && tenants === 0 && allocations === 0 && rentObs === 0 && payments === 0 && expenses === 0 && agreements === 0 && invitations === 0) {
        console.log(`Hostel ${id} is completely empty. Deleting...`);
        // Delete related snapshots first
        await (prisma as any).hostelDailySnapshot.deleteMany({ where: { hostel_id: id } });
        // Delete hostel
        await prisma.hostel.delete({ where: { id } });
        console.log(`Deleted successfully.`);
      } else {
        console.log(`Hostel ${id} has dependencies. Deletion skipped.`);
      }
    }
  } catch (err: any) {
    console.error("Error during cleanup:", err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
