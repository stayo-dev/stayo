import { prisma } from "../lib/db";
import { randomUUID } from "crypto";

async function main() {
  const email = 'sharan@gmail.com';
  const owners = await prisma.profile.findMany({ where: { email } });
  
  if (!owners.length) throw new Error("No owners found");

  for (const owner of owners) {
    let hostel = await prisma.hostels.findFirst({ where: { owner_id: owner.id } });
    if (!hostel) {
      hostel = await prisma.hostels.create({
        data: {
          id: randomUUID(),
          owner_id: owner.id,
          name: "Test Hostel",
          phone: "9999999999",
          address: "123 Test St",
          status: "ACTIVE",
        }
      });
    }

    // 1. Create a Notification (Admin Broadcast)
    await prisma.notifications.create({
      data: {
        profile_id: owner.id,
        title: "Platform Maintenance",
        message: "StayO platform will be undergoing maintenance tonight from 2AM to 4AM.",
        type: "ADMIN_BROADCAST",
        is_read: false,
      }
    });

    // Ensure we have a tenant for agreements/requests
    let tenant = await prisma.tenants.findFirst({ where: { hostel_id: hostel.id } });
    if (!tenant) {
      const tenantProfile = await prisma.profile.create({
        data: {
          id: randomUUID(),
          email: `dummy-tenant-${Date.now()}-${randomUUID().slice(0, 5)}@test.com`,
          name: "Test Tenant",
          role: "TENANT",
        }
      });
      let floor = await prisma.floors.findFirst({ where: { hostel_id: hostel.id } });
      if (!floor) {
        floor = await prisma.floors.create({
          data: {
            id: randomUUID(),
            hostel_id: hostel.id,
            owner_id: owner.id,
            name: "Ground Floor",
            sort_order: 0,
          }
        });
      }
      let room = await prisma.rooms.findFirst({ where: { hostel_id: hostel.id } });
      if (!room) {
        room = await prisma.rooms.create({
          data: {
            id: randomUUID(),
            hostel_id: hostel.id,
            floor_id: floor.id,
            room_no: "101",
            capacity: 2,
          }
        });
      }
      tenant = await prisma.tenants.create({
        data: {
          id: randomUUID(),
          profile_id: tenantProfile.id,
          hostel_id: hostel.id,
          status: "ACTIVE",
        }
      });
    }

    // 2. Create an expiring agreement (Renewal)
    const nextWeek = new Date();
    nextWeek.setDate(nextWeek.getDate() + 7);
    
    let template = await prisma.AgreementTemplate.findFirst({ where: { hostel_id: hostel.id } });
    if (!template) {
      template = await prisma.AgreementTemplate.create({
        data: {
          id: randomUUID(),
          hostel_id: hostel.id,
          title: "Standard Template",
          version: "1.0",
          version_number: 1,
          owner_name: owner.name || "Test Owner",
          rules_content: {},
          status: "PUBLISHED",
        }
      });
    }

    await prisma.Agreement.create({
      data: {
        tenant_id: tenant.id,
        hostel_id: hostel.id,
        template_id: template.id,
        status: "SIGNED",
        agreement_end_date: nextWeek,
        content_snapshot: {},
      }
    });

    // 3. Create a tenant service request
    await prisma.tenant_service_requests.create({
      data: {
        hostel_id: hostel.id,
        tenant_id: tenant.id,
        type: "MAINTENANCE",
        description: "The AC in room 101 is not cooling properly.",
        status: "RAISED",
      }
    });
  }

  console.log("Seeded test alerts successfully!");
}

main().catch(console.error).finally(() => process.exit(0));
