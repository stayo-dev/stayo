import { prisma } from "../lib/db";
import crypto from "crypto";

async function main() {
  let invite = await prisma.tenant_invitations.findFirst({
    where: { status: "PENDING" }
  });

  if (!invite) {
    console.log("No pending invitation found. Creating a test invitation...");
    const owner = await prisma.profile.findFirst({ where: { role: "OWNER" } });
    if (!owner) throw new Error("No owner found");
    const room = await prisma.rooms.findFirst();
    if (!room) throw new Error("No room found");

    const tenantId = crypto.randomUUID();
    const inviteId = crypto.randomUUID();
    const token = crypto.randomBytes(32).toString("hex");

    const tenant = await prisma.tenants.create({
      data: {
        id: tenantId,
        owner_id: owner.id,
        hostel_id: room.hostel_id,
        monthly_rent: 5000,
        joined_on: new Date(),
        billing_start_date: new Date(),
        status: "INVITED",
        advance_deposit: 1000,
        phone_1: "+919876543210",
      }
    });

    invite = await prisma.tenant_invitations.create({
      data: {
        id: inviteId,
        tenant_id: tenantId,
        owner_id: owner.id,
        hostel_id: room.hostel_id,
        room_id: room.id,
        name: "Test Tenant Onboarding",
        phone: "+919876543210",
        token: token,
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        status: "PENDING"
      }
    });
  }

  console.log("=== Active Invitation ===");
  console.log({
    id: invite.id,
    name: invite.name,
    phone: invite.phone,
    email: invite.email,
    token: invite.token,
    url: `http://localhost:5174/activate/${invite.token}`
  });
}

main().catch(console.error);
