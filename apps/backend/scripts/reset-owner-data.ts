import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient({
  log: ["query", "info", "warn", "error"]
});

async function main() {
  const ownerId = "0b301633-272e-4856-b9a5-773faf3a58da";
  console.log("Starting reset for owner ID:", ownerId);

  // Get all hostels of this owner
  const hostels = await prisma.hostels.findMany({
    where: { owner_id: ownerId }
  });
  const hostelIds = hostels.map((h: any) => h.id);
  console.log("Hostel IDs to reset:", hostelIds);

  if (hostelIds.length === 0) {
    console.log("No hostels found for this owner.");
    return;
  }

  // Get all tenants of this owner
  const tenants = await prisma.tenants.findMany({
    where: { owner_id: ownerId }
  });
  const tenantIds = tenants.map((t: any) => t.id);
  console.log("Tenant IDs count to delete:", tenantIds.length);

  // Get all invitations
  const invitations = await prisma.tenant_invitations.findMany({
    where: { owner_id: ownerId }
  });
  const invitationIds = invitations.map((i: any) => i.id);
  console.log("Invitation IDs count to delete:", invitationIds.length);

  // Get all visitor leads
  const leads = await prisma.visitor_leads.findMany({
    where: { owner_id: ownerId }
  });
  const leadIds = leads.map((l: any) => l.id);

  console.log("Deleting related data...");

  // 1. Delete dependent/child tables first
  if (tenantIds.length > 0) {
    await prisma.receipts.deleteMany({
      where: { hostel_id: { in: hostelIds } }
    });
    console.log("Deleted receipts");

    await prisma.payments.deleteMany({
      where: {
        OR: [
          { owner_id: ownerId },
          { tenant_id: { in: tenantIds } },
          { hostel_id: { in: hostelIds } }
        ]
      }
    });
    console.log("Deleted payments");

    await prisma.rent_obligations.deleteMany({
      where: {
        OR: [
          { owner_id: ownerId },
          { tenant_id: { in: tenantIds } },
          { hostel_id: { in: hostelIds } }
        ]
      }
    });
    console.log("Deleted rent obligations");

    await prisma.roomAllocation.deleteMany({
      where: { tenant_id: { in: tenantIds } }
    });
    console.log("Deleted room allocations");

    await prisma.tenant_billing_plans.deleteMany({
      where: { tenant_id: { in: tenantIds } }
    });
    console.log("Deleted tenant billing plans");

    await prisma.tenant_behavior_scores.deleteMany({
      where: { tenant_id: { in: tenantIds } }
    });
    console.log("Deleted tenant behavior scores");

    await prisma.tenant_transfer_logs.deleteMany({
      where: { tenant_id: { in: tenantIds } }
    });
    console.log("Deleted tenant transfer logs");

    await prisma.move_out_requests.deleteMany({
      where: { tenant_id: { in: tenantIds } }
    });
    console.log("Deleted move out requests");

    await prisma.tenant_advance_ledger.deleteMany({
      where: { tenant_id: { in: tenantIds } }
    });
    console.log("Deleted tenant advance ledger");
  }

  if (invitationIds.length > 0) {
    await prisma.tenant_invitation_reservations.deleteMany({
      where: { invitation_id: { in: invitationIds } }
    });
    console.log("Deleted invitation reservations");

    await prisma.tenant_invitations.deleteMany({
      where: { owner_id: ownerId }
    });
    console.log("Deleted tenant invitations");
  }

  if (leadIds.length > 0) {
    await prisma.lead_notes.deleteMany({
      where: { lead_id: { in: leadIds } }
    });
    await prisma.lead_activities.deleteMany({
      where: { lead_id: { in: leadIds } }
    });
    await prisma.visitor_leads.deleteMany({
      where: { owner_id: ownerId }
    });
    console.log("Deleted visitor leads, notes, and activities");
  }

  // Delete expenses
  await prisma.expenses.deleteMany({
    where: { owner_id: ownerId }
  });
  console.log("Deleted expenses");

  // Delete notifications and activity logs
  await prisma.notifications.deleteMany({
    where: { profile_id: ownerId }
  });
  console.log("Deleted notifications");

  await prisma.activity_logs.deleteMany({
    where: { owner_id: ownerId }
  });
  console.log("Deleted activity logs");

  await prisma.room_activity_logs.deleteMany({
    where: { owner_id: ownerId }
  });
  console.log("Deleted room activity logs");

  await prisma.room_reservations.deleteMany({
    where: { hostel_id: { in: hostelIds } }
  });
  console.log("Deleted room reservations");

  // Finally delete tenants
  if (tenantIds.length > 0) {
    await prisma.tenants.deleteMany({
      where: { owner_id: ownerId }
    });
    console.log("Deleted tenants");
  }

  console.log("Reset complete successfully!");
}

main().catch(console.error).finally(() => prisma.$disconnect());
