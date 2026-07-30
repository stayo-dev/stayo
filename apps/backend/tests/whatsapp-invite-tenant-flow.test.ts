import { describe, expect, it, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { whatsappWebhookEventService } from "@/lib/services/notifications/whatsapp-webhook-event-service";
import { MetaWhatsAppProvider } from "@/lib/services/notifications/providers/whatsapp/meta-provider";
import { getSelectionState, deleteSelectionState, setSelectionState } from "@/lib/services/notifications/whatsapp-selection-state";
import { rateLimitService } from "@/lib/services/rate-limit-service";
import crypto from "crypto";
import { tenantInvitationLifecycleService } from "@/src/services/tenants/tenant-invitation-lifecycle-service";
import { ownerWhatsAppAssistantService } from "@/lib/services/notifications/owner-whatsapp-assistant";

vi.spyOn(MetaWhatsAppProvider.prototype, "sendTemplate").mockResolvedValue({
  providerMessageId: "mock-template-id-12345",
  raw: { success: true },
  attempts: 1,
});

vi.spyOn(MetaWhatsAppProvider.prototype, "sendTextMessage").mockResolvedValue({
  providerMessageId: "mock-text-id-12345",
  raw: { success: true },
  attempts: 1,
});

vi.spyOn(MetaWhatsAppProvider.prototype, "sendInvitation").mockResolvedValue({
  providerMessageId: "mock-invitation-id-12345",
  attempts: 1,
} as any);

vi.spyOn(rateLimitService, "checkStatelessLimit").mockImplementation(async () => {
  return { allowed: true, attemptsRemaining: 5 };
});

describe("WhatsApp Tenant Onboarding - Invite Flow", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await prisma.$executeRaw`TRUNCATE TABLE "test"."profiles" CASCADE`;
    await prisma.$executeRaw`TRUNCATE TABLE "test"."owner_whatsapp_identities" CASCADE`;
    await prisma.$executeRaw`TRUNCATE TABLE "test"."hostels" CASCADE`;
  });

  function makeWebhookPayload(from: string, bodyText: string) {
    const eventId = crypto.randomUUID();
    const payload = {
      object: "whatsapp_business_account",
      entry: [
        {
          id: "1498172691262458",
          changes: [
            {
              value: {
                messaging_product: "whatsapp",
                metadata: {
                  display_phone_number: "15550541785",
                  phone_number_id: "1085964934609759",
                },
                contacts: [
                  {
                    profile: { name: "Owner Name" },
                    wa_id: from,
                  },
                ],
                messages: [
                  {
                    from,
                    id: `wamid.${crypto.randomUUID()}`,
                    timestamp: String(Math.floor(Date.now() / 1000)),
                    text: { body: bodyText },
                    type: "text",
                  },
                ],
              },
              field: "messages",
            },
          ],
        },
      ],
    };
    return { eventId, payload };
  }

  async function seedOwnerAndProperties(ownerPhone: string, numHostels: number = 1) {
    const ownerId = crypto.randomUUID();
    const ownerEmail = `owner-${crypto.randomUUID().substring(0, 8)}@test.com`;

    // 1. Create Owner Profile
    await prisma.$executeRaw`
      INSERT INTO "test"."profiles" (id, email, name, role)
      VALUES (${ownerId}::uuid, ${ownerEmail}, 'Sri Owner', 'OWNER')
    `;

    // 2. Create Owner WhatsApp Identity
    await prisma.$executeRaw`
      INSERT INTO "test"."owner_whatsapp_identities" (id, owner_id, phone_number, is_verified, verified_at, updated_at)
      VALUES (${crypto.randomUUID()}::uuid, ${ownerId}::uuid, ${ownerPhone}, true, now(), now())
    `;

    const hostels: { id: string; name: string }[] = [];
    const rooms: { id: string; room_no: string; base_rent: number }[] = [];

    // 3. Create Hostels and Rooms
    for (let i = 1; i <= numHostels; i++) {
      const hostelId = crypto.randomUUID();
      const hostelName = `Sri Hostel ${i}`;
      await prisma.$executeRaw`
        INSERT INTO "test"."hostels" (id, owner_id, name, phone, address, is_active, preferences_config)
        VALUES (${hostelId}::uuid, ${ownerId}::uuid, ${hostelName}, '1234567890', 'Test Address', true, '{"billing_defaults": {"advance_deposit": 5000, "maintenance_charge": 500, "maintenance_type": "MONTHLY", "auto_fill_room_rent": true, "allow_override": true}}'::jsonb)
      `;
      hostels.push({ id: hostelId, name: hostelName });

      // Create a vacant room
      const roomId = crypto.randomUUID();
      const roomNo = `${100 + i}`;
      await prisma.$executeRaw`
        INSERT INTO "test"."rooms" (id, hostel_id, room_no, capacity, base_rent, is_active)
        VALUES (${roomId}::uuid, ${hostelId}::uuid, ${roomNo}, 2, 8000, true)
      `;
      rooms.push({ id: roomId, room_no: roomNo, base_rent: 8000 });
    }

    return { ownerId, hostels, rooms };
  }

  it("Scenario 1: Happy Path with a single hostel (auto-selects hostel, prompts room)", async () => {
    const ownerPhone = "919999999999";
    const { rooms } = await seedOwnerAndProperties(ownerPhone, 1);
    const room = rooms[0];

    // Step 1: Start Flow
    const payload1 = makeWebhookPayload(ownerPhone, "INVITE");
    let result = await whatsappWebhookEventService.processWebhookEvent(payload1.eventId, payload1.payload);
    expect(result).toBeDefined();

    let state: any = await getSelectionState(ownerPhone);
    expect(state).toBeDefined();
    expect(state?.step).toBe("AWAITING_NAME");

    // Step 2: Name Input
    const payload2 = makeWebhookPayload(ownerPhone, "John Doe");
    result = await whatsappWebhookEventService.processWebhookEvent(payload2.eventId, payload2.payload);
    state = await getSelectionState(ownerPhone);
    expect(state?.step).toBe("AWAITING_PHONE");
    expect(state?.data.name).toBe("John Doe");

    // Step 3: Phone Input (1 hostel -> auto-selects and jumps to room listing)
    const payload3 = makeWebhookPayload(ownerPhone, "9876543210");
    result = await whatsappWebhookEventService.processWebhookEvent(payload3.eventId, payload3.payload);
    state = await getSelectionState(ownerPhone);
    expect(state?.step).toBe("AWAITING_ROOM");
    expect(state?.data.phone).toBe("+919876543210");
    expect(state?.data.hostelId).toBeDefined();

    // Room Input
    const payload4 = makeWebhookPayload(ownerPhone, room.room_no);
    result = await whatsappWebhookEventService.processWebhookEvent(payload4.eventId, payload4.payload);
    state = await getSelectionState(ownerPhone);
    expect(state?.step).toBe("AWAITING_CONFIRMATION");
    expect(state?.data.roomId).toBe(room.id);

    // Step 5: Confirmation (YES)
    const payload5 = makeWebhookPayload(ownerPhone, "YES");
    result = await whatsappWebhookEventService.processWebhookEvent(payload5.eventId, payload5.payload);
    state = await getSelectionState(ownerPhone);
    expect(state).toBeNull(); // Cleaned up

    // Verify invitation entry in DB
    const invitation = await prisma.tenant_invitations.findFirst({
      where: { phone: "+919876543210" },
    });
    expect(invitation).toBeDefined();
    expect(invitation?.name).toBe("John Doe");

    const tenant = await prisma.tenants.findFirst({
      where: { id: invitation?.tenant_id },
    });
    expect(tenant).toBeDefined();
    expect(Number(tenant?.monthly_rent)).toBe(8000);
  });

  it("Scenario 2: Flow with multiple hostels (requires hostel selection step)", async () => {
    const ownerPhone = "919999999999";
    const { hostels, rooms } = await seedOwnerAndProperties(ownerPhone, 2);
    const room = rooms[0];

    // Step 1: Start Flow
    const payload1 = makeWebhookPayload(ownerPhone, "INVITE");
    await whatsappWebhookEventService.processWebhookEvent(payload1.eventId, payload1.payload);

    // Step 2: Name Input
    const payload2 = makeWebhookPayload(ownerPhone, "Jane Smith");
    await whatsappWebhookEventService.processWebhookEvent(payload2.eventId, payload2.payload);

    // Step 3: Phone Input -> should transition to AWAITING_HOSTEL
    const payload3 = makeWebhookPayload(ownerPhone, "8888888888");
    await whatsappWebhookEventService.processWebhookEvent(payload3.eventId, payload3.payload);

    let state: any = await getSelectionState(ownerPhone);
    expect(state?.step).toBe("AWAITING_HOSTEL");
    expect(state?.data.phone).toBe("+918888888888");

    // Step 4: Hostel Selection (select Sri Hostel 1 by index '1')
    const payload4 = makeWebhookPayload(ownerPhone, "1");
    await whatsappWebhookEventService.processWebhookEvent(payload4.eventId, payload4.payload);

    state = await getSelectionState(ownerPhone);
    expect(state?.step).toBe("AWAITING_ROOM");
    expect(state?.data.hostelId).toBe(hostels[0].id);

    // Step 5: Room Selection
    const payload5 = makeWebhookPayload(ownerPhone, room.room_no);
    await whatsappWebhookEventService.processWebhookEvent(payload5.eventId, payload5.payload);

    state = await getSelectionState(ownerPhone);
    expect(state?.step).toBe("AWAITING_CONFIRMATION");

    // Step 6: Confirmation (YES)
    const payload6 = makeWebhookPayload(ownerPhone, "YES");
    await whatsappWebhookEventService.processWebhookEvent(payload6.eventId, payload6.payload);

    state = await getSelectionState(ownerPhone);
    expect(state).toBeNull();

    const invitation = await prisma.tenant_invitations.findFirst({
      where: { phone: "+918888888888" },
    });
    expect(invitation).toBeDefined();
    expect(invitation?.name).toBe("Jane Smith");
  });

  it("Scenario 3: Aborts flow with CANCEL command", async () => {
    const ownerPhone = "919999999999";
    await seedOwnerAndProperties(ownerPhone, 1);

    // Start
    const payload1 = makeWebhookPayload(ownerPhone, "INVITE");
    await whatsappWebhookEventService.processWebhookEvent(payload1.eventId, payload1.payload);

    // Cancel
    const payload2 = makeWebhookPayload(ownerPhone, "CANCEL");
    await whatsappWebhookEventService.processWebhookEvent(payload2.eventId, payload2.payload);

    const state = await getSelectionState(ownerPhone);
    expect(state).toBeNull();
  });

  it("Scenario 4: Structured Complete Command with multiple hostels", async () => {
    const ownerPhone = "919999999999";
    const { hostels, rooms } = await seedOwnerAndProperties(ownerPhone, 2);

    // Command: invite John Doe 9876543210 Sri Hostel 1 101
    const payload1 = makeWebhookPayload(ownerPhone, "invite John Doe 9876543210 Sri Hostel 1 101");
    const result = await whatsappWebhookEventService.processWebhookEvent(payload1.eventId, payload1.payload);
    expect(result).toBeDefined();

    const state: any = await getSelectionState(ownerPhone);
    expect(state).toBeDefined();
    expect(state?.step).toBe("AWAITING_CONFIRMATION");
    expect(state?.data.name).toBe("John Doe");
    expect(state?.data.phone).toBe("+919876543210");
    expect(state?.data.hostelId).toBe(hostels[0].id);
    expect(state?.data.roomId).toBe(rooms[0].id);

    // Confirm
    const payload2 = makeWebhookPayload(ownerPhone, "YES");
    await whatsappWebhookEventService.processWebhookEvent(payload2.eventId, payload2.payload);

    const endState = await getSelectionState(ownerPhone);
    expect(endState).toBeNull();

    const invitation = await prisma.tenant_invitations.findFirst({
      where: { phone: "+919876543210" },
    });
    expect(invitation).toBeDefined();
    expect(invitation?.name).toBe("John Doe");
  });

  it("Scenario 5: Structured Partial Command with multiple hostels", async () => {
    const ownerPhone = "919999999999";
    const { hostels, rooms } = await seedOwnerAndProperties(ownerPhone, 2);

    // Command: invite Jane Doe 9876543211
    const payload1 = makeWebhookPayload(ownerPhone, "invite Jane Doe 9876543211");
    await whatsappWebhookEventService.processWebhookEvent(payload1.eventId, payload1.payload);

    let state: any = await getSelectionState(ownerPhone);
    expect(state).toBeDefined();
    expect(state?.step).toBe("AWAITING_HOSTEL");
    expect(state?.data.name).toBe("Jane Doe");
    expect(state?.data.phone).toBe("+919876543211");

    // Select Hostel 2
    const payload2 = makeWebhookPayload(ownerPhone, "2");
    await whatsappWebhookEventService.processWebhookEvent(payload2.eventId, payload2.payload);

    state = await getSelectionState(ownerPhone);
    expect(state?.step).toBe("AWAITING_ROOM");
    expect(state?.data.hostelId).toBe(hostels[1].id);

    // Select Room 102
    const payload3 = makeWebhookPayload(ownerPhone, "102");
    await whatsappWebhookEventService.processWebhookEvent(payload3.eventId, payload3.payload);

    state = await getSelectionState(ownerPhone);
    expect(state?.step).toBe("AWAITING_CONFIRMATION");
    expect(state?.data.roomId).toBe(rooms[1].id);

    // Confirm
    const payload4 = makeWebhookPayload(ownerPhone, "YES");
    await whatsappWebhookEventService.processWebhookEvent(payload4.eventId, payload4.payload);

    const endState = await getSelectionState(ownerPhone);
    expect(endState).toBeNull();

    const invitation = await prisma.tenant_invitations.findFirst({
      where: { phone: "+919876543211" },
    });
    expect(invitation).toBeDefined();
    expect(invitation?.name).toBe("Jane Doe");
  });

  it("Scenario 6: Structured Single-Hostel Command (hostel inferred automatically)", async () => {
    const ownerPhone = "919999999999";
    const { rooms } = await seedOwnerAndProperties(ownerPhone, 1);

    // Command: invite Sam 9876543212 101
    const payload1 = makeWebhookPayload(ownerPhone, "invite Sam 9876543212 101");
    await whatsappWebhookEventService.processWebhookEvent(payload1.eventId, payload1.payload);

    const state: any = await getSelectionState(ownerPhone);
    expect(state).toBeDefined();
    expect(state?.step).toBe("AWAITING_CONFIRMATION");
    expect(state?.data.name).toBe("Sam");
    expect(state?.data.phone).toBe("+919876543212");
    expect(state?.data.roomId).toBe(rooms[0].id);
  });

  it("Scenario 7: Delimiter Support (comma separated)", async () => {
    const ownerPhone = "919999999999";
    const { hostels, rooms } = await seedOwnerAndProperties(ownerPhone, 2);

    // Command: invite Bob, 9876543213, Sri Hostel 1, 101
    const payload1 = makeWebhookPayload(ownerPhone, "invite Bob, 9876543213, Sri Hostel 1, 101");
    await whatsappWebhookEventService.processWebhookEvent(payload1.eventId, payload1.payload);

    const state: any = await getSelectionState(ownerPhone);
    expect(state).toBeDefined();
    expect(state?.step).toBe("AWAITING_CONFIRMATION");
    expect(state?.data.name).toBe("Bob");
    expect(state?.data.phone).toBe("+919876543213");
    expect(state?.data.hostelId).toBe(hostels[0].id);
    expect(state?.data.roomId).toBe(rooms[0].id);
  });

  it("Scenario 8: Duplicate Phone Check in Structured Command", async () => {
    const ownerPhone = "919999999999";
    const { ownerId, rooms } = await seedOwnerAndProperties(ownerPhone, 1);

    // Seed an invitation with phone 9876543210
    await tenantInvitationLifecycleService.createInvitation({
      name: "Existing User",
      phone: "9876543210",
      room_id: rooms[0].id,
      monthly_rent: rooms[0].base_rent,
    }, ownerId);

    // Command: invite New Name 9876543210
    const payload1 = makeWebhookPayload(ownerPhone, "invite New Name 9876543210");
    await whatsappWebhookEventService.processWebhookEvent(payload1.eventId, payload1.payload);

    // Selection state should be deleted due to duplicate error
    const state = await getSelectionState(ownerPhone);
    expect(state).toBeNull();
  });

  it("Scenario 9: Room capacity collision check with active/pending invitations", async () => {
    const ownerPhone = "919999999999";
    const { ownerId, rooms } = await seedOwnerAndProperties(ownerPhone, 1);

    // Update room capacity to 1 (making it a single occupancy room)
    await prisma.rooms.update({
      where: { id: rooms[0].id },
      data: { capacity: 1 },
    });

    // Create an active invitation to room 101 for tenant A
    await tenantInvitationLifecycleService.createInvitation({
      name: "Tenant A",
      phone: "9876543215",
      room_id: rooms[0].id,
      monthly_rent: rooms[0].base_rent,
    }, ownerId);

    // Now try to invite Jane B to the same room 101.
    // Command: invite Jane B 9876543216 101
    const payload1 = makeWebhookPayload(ownerPhone, "invite Jane B 9876543216 101");
    await whatsappWebhookEventService.processWebhookEvent(payload1.eventId, payload1.payload);

    // Since room 101 is already reserved (capacity 1, 1 active invitation),
    // there are no vacant beds available in the hostel, so the flow should cancel.
    const state = await getSelectionState(ownerPhone);
    expect(state).toBeNull(); // Selection state deleted due to no vacancy
  });

  it("Scenario 10: Tenants and Guardians cannot connect/link to the Owner WhatsApp Assistant", async () => {
    const ownerPhone = "919999999999";
    const { ownerId, hostels } = await seedOwnerAndProperties(ownerPhone, 1);

    // 1. Generate a link code for the owner
    const linkRes = await ownerWhatsAppAssistantService.createLinkCode(ownerId);
    const code = linkRes.link_code;

    // 2. Seed a tenant profile and a tenant record with matching phone number "919876543210"
    const tenantId = crypto.randomUUID();
    const tenantPhone = "919876543210";
    await prisma.$executeRaw`
      INSERT INTO "test"."profiles" (id, email, name, role, phone)
      VALUES (${tenantId}::uuid, 'tenant@test.com', 'Jane Tenant', 'TENANT', ${tenantPhone})
    `;
    await prisma.$executeRaw`
      INSERT INTO "test"."tenants" (id, profile_id, hostel_id, phone_1, status)
      VALUES (${crypto.randomUUID()}::uuid, ${tenantId}::uuid, ${hostels[0].id}::uuid, ${tenantPhone}, 'ACTIVE')
    `;

    // 3. Try to link using the tenant's phone number
    const payloadTenant = makeWebhookPayload(tenantPhone, `LINK ${code}`);
    await whatsappWebhookEventService.processWebhookEvent(payloadTenant.eventId, payloadTenant.payload);

    // The identity should NOT be verified for the tenant's phone
    const tenantIdentity = await prisma.owner_whatsapp_identities.findFirst({
      where: { phone_number: tenantPhone },
    });
    expect(tenantIdentity).toBeNull();

    // 4. Seed a guardian phone "919876543211" under a tenant
    const anotherTenantId = crypto.randomUUID();
    await prisma.$executeRaw`
      INSERT INTO "test"."profiles" (id, email, name, role)
      VALUES (${anotherTenantId}::uuid, 'tenant2@test.com', 'Sam Tenant', 'TENANT')
    `;
    await prisma.$executeRaw`
      INSERT INTO "test"."tenants" (id, profile_id, hostel_id, guardian_phone, status)
      VALUES (${crypto.randomUUID()}::uuid, ${anotherTenantId}::uuid, ${hostels[0].id}::uuid, '9876543211', 'ACTIVE')
    `;

    // Try to link using the guardian's phone number
    const payloadGuardian = makeWebhookPayload("919876543211", `LINK ${code}`);
    await whatsappWebhookEventService.processWebhookEvent(payloadGuardian.eventId, payloadGuardian.payload);

    // The identity should NOT be verified for the guardian's phone
    const guardianIdentity = await prisma.owner_whatsapp_identities.findFirst({
      where: { phone_number: "919876543211" },
    });
    expect(guardianIdentity).toBeNull();
  });

  it("Scenario 11: Global Phone Uniqueness Check in Structured Command (Cross-Hostel)", async () => {
    const ownerPhone = "919999999999";
    const { hostels } = await seedOwnerAndProperties(ownerPhone, 2);

    // Seed an active tenant in Hostel 1
    const activeTenantId = crypto.randomUUID();
    const tenantPhone = "+917777777777";
    await prisma.$executeRaw`
      INSERT INTO "test"."profiles" (id, email, name, role, phone)
      VALUES (${activeTenantId}::uuid, 'active-tenant-test@test.com', 'Active Tenant Test', 'TENANT', ${tenantPhone})
    `;
    await prisma.$executeRaw`
      INSERT INTO "test"."tenants" (id, profile_id, hostel_id, phone_1, status)
      VALUES (${crypto.randomUUID()}::uuid, ${activeTenantId}::uuid, ${hostels[0].id}::uuid, ${tenantPhone}, 'ACTIVE')
    `;

    const sendTextMessageSpy = vi.spyOn(MetaWhatsAppProvider.prototype, "sendTextMessage");

    // Command: invite New Guy 7777777777 Sri Hostel 2 101
    const payload = makeWebhookPayload(ownerPhone, "invite New Guy 7777777777 Sri Hostel 2 101");
    await whatsappWebhookEventService.processWebhookEvent(payload.eventId, payload.payload);

    // Selection state should be deleted due to duplicate error
    const state = await getSelectionState(ownerPhone);
    expect(state).toBeNull();

    expect(sendTextMessageSpy).toHaveBeenCalledWith(
      expect.stringContaining(ownerPhone.slice(-10)),
      expect.stringContaining("Cannot invite: Tenant 'Active Tenant Test' with this phone number is already active in Sri Hostel 1.")
    );
  });

  it("Scenario 12: Global Phone Uniqueness Check in Guided Wizard (AWAITING_PHONE)", async () => {
    const ownerPhone = "919999999999";
    const { hostels } = await seedOwnerAndProperties(ownerPhone, 2);

    // Seed an active tenant in Hostel 1
    const activeTenantId = crypto.randomUUID();
    const tenantPhone = "+917777777777";
    await prisma.$executeRaw`
      INSERT INTO "test"."profiles" (id, email, name, role, phone)
      VALUES (${activeTenantId}::uuid, 'active-tenant-test@test.com', 'Active Tenant Test', 'TENANT', ${tenantPhone})
    `;
    await prisma.$executeRaw`
      INSERT INTO "test"."tenants" (id, profile_id, hostel_id, phone_1, status)
      VALUES (${crypto.randomUUID()}::uuid, ${activeTenantId}::uuid, ${hostels[0].id}::uuid, ${tenantPhone}, 'ACTIVE')
    `;

    // Initialize state to AWAITING_PHONE using the helper function setSelectionState
    await setSelectionState(ownerPhone, {
      phone: ownerPhone,
      action: "INVITE_TENANT",
      step: "AWAITING_PHONE",
      data: { name: "New Guy" }
    });

    const sendTextMessageSpy = vi.spyOn(MetaWhatsAppProvider.prototype, "sendTextMessage");

    // Send the duplicate phone number
    const payload = makeWebhookPayload(ownerPhone, "7777777777");
    await whatsappWebhookEventService.processWebhookEvent(payload.eventId, payload.payload);

    // Selection state should be deleted
    const state = await getSelectionState(ownerPhone);
    expect(state).toBeNull();

    expect(sendTextMessageSpy).toHaveBeenCalledWith(
      expect.stringContaining(ownerPhone.slice(-10)),
      expect.stringContaining("Cannot invite: Tenant 'Active Tenant Test' with this phone number is already active in Sri Hostel 1.")
    );
  });
}, 30000);
