import { prisma } from "../lib/db";
import { DashboardService } from "../lib/services/dashboard-service";

async function main() {
  const hostelId = "ea89eed3-56b0-41bb-93ca-2f66a4e805d9";
  console.log("Analyzing database stats for hostel:", hostelId);

  try {
    const hostels = await prisma.hostels.findMany({
      include: { profiles: true }
    });
    console.log("All Hostels in DB:");
    for (const h of hostels) {
      console.log(`- ID: ${h.id}, Name: ${h.name}, Owner: ${h.profiles.email}`);
    }

    const allMoveOuts = await prisma.move_out_requests.findMany({
      include: {
        tenant: { include: { profiles: true } },
        inspection: true,
        settlement: true
      }
    });
    console.log("\nAll Move Out Requests in DB (JSON):");
    console.log(JSON.stringify(allMoveOuts, null, 2));

    const hostel = await prisma.hostels.findUnique({
      where: { id: hostelId },
      include: { profiles: true }
    });
    if (!hostel) {
      console.log("Hostel not found!");
      return;
    }
    console.log("Hostel Name:", hostel.name);
    console.log("Owner Email:", hostel.profiles.email, "Owner ID:", hostel.profiles.id);

    // Get stats shell
    const dashboardService = new DashboardService();
    const stats = await dashboardService.getOwnerStatsShell(hostel.profiles.id, hostelId);
    console.log("\n--- Owner Stats Shell Result ---");
    console.log("Revenue:", stats.revenue);
    console.log("Expected Revenue:", stats.expected_revenue);
    console.log("Pending Dues (pending_dues):", stats.pending_dues);
    console.log("Overdue Amount (overdue_amount):", stats.overdue_amount);
    console.log("Collection Rate:", stats.collection_rate);

    // Let's inspect rent obligations
    const obligations = await prisma.rent_obligations.findMany({
      where: { hostel_id: hostelId },
      include: { tenants: { include: { profiles: true } } }
    });
    console.log("\n--- Rent Obligations ---");
    for (const ob of obligations) {
      console.log(`ID: ${ob.id}, Tenant: ${ob.tenants?.profiles?.name}, Month: ${ob.rent_month.toISOString().split('T')[0]}, Due Date: ${ob.due_date.toISOString().split('T')[0]}, Amount: ${ob.amount}, Status: ${ob.status}`);
    }

    // Let's inspect payments
    const payments = await prisma.payments.findMany({
      where: { hostel_id: hostelId },
      include: { tenants: { include: { profiles: true } } }
    });
    console.log("\n--- Payments ---");
    for (const p of payments) {
      console.log(`ID: ${p.id}, Tenant: ${p.tenants?.profiles?.name}, Date: ${p.payment_date.toISOString().split('T')[0]}, Amount: ${p.amount_paid}, Obligation ID: ${p.obligation_id}`);
    }

    // Let's inspect move out requests
    const moveOuts = await prisma.move_out_requests.findMany({
      where: { hostel_id: hostelId },
      include: { tenant: { include: { profiles: true } } }
    });
    console.log("\n--- Move Out Requests ---");
    for (const m of moveOuts) {
      console.log(`ID: ${m.id}, Tenant: ${m.tenant?.profiles?.name}, Status: ${m.status}, Reason: ${m.reason}, PlannedExit: ${m.planned_exit_date?.toISOString()}, ActualExit: ${m.actual_exit_date?.toISOString()}, PhysicalExit: ${m.physical_exit_date?.toISOString()}, Created At: ${m.created_at}`);
    }

    // Let's inspect active tenants
    const activeTenants = await prisma.tenants.findMany({
      where: { hostel_id: hostelId, status: 'ACTIVE' },
      include: { profiles: true }
    });
    console.log("\n--- Active Tenants ---");
    for (const t of activeTenants) {
      console.log(`ID: ${t.id}, Name: ${t.profiles?.name}, Status: ${t.status}`);
    }

  } catch (err) {
    console.error("Error running script:", err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
