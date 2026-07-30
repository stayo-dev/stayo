import { describe, expect, it, vi, beforeEach, beforeAll } from "vitest";
import { prisma } from "@/lib/db";
import { whatsappWebhookEventService } from "@/lib/services/notifications/whatsapp-webhook-event-service";
import { MetaWhatsAppProvider } from "@/lib/services/notifications/providers/whatsapp/meta-provider";
import { dashboardService } from "@/lib/services/dashboard-service";
import crypto from "crypto";

// Spy on Meta WhatsApp Provider to mock network requests
const mockSendTextMessage = vi.spyOn(MetaWhatsAppProvider.prototype, "sendTextMessage").mockResolvedValue({
  providerMessageId: "mock-text-id-12345",
  raw: { success: true },
  attempts: 1,
});

const mockSendListMessage = vi.spyOn(MetaWhatsAppProvider.prototype, "sendListMessage").mockResolvedValue({
  providerMessageId: "mock-list-id-12345",
  raw: { success: true },
  attempts: 1,
});

const mockSendButtonMessage = vi.spyOn(MetaWhatsAppProvider.prototype, "sendButtonMessage").mockResolvedValue({
  providerMessageId: "mock-button-id-12345",
  raw: { success: true },
  attempts: 1,
});

const mockSendTemplate = vi.spyOn(MetaWhatsAppProvider.prototype, "sendTemplate").mockResolvedValue({
  providerMessageId: "mock-template-id-12345",
  raw: { success: true },
  attempts: 1,
});

describe("WhatsApp Owner Briefing Integration Tests", () => {
  beforeAll(async () => {
    vi.setConfig({ testTimeout: 20000 });
    await prisma.$executeRaw`TRUNCATE TABLE "test"."profiles" CASCADE`;
    await prisma.$executeRaw`TRUNCATE TABLE "test"."owner_daily_briefings" CASCADE`;
    await prisma.$executeRaw`TRUNCATE TABLE "test"."owner_whatsapp_identities" CASCADE`;
  });

  beforeEach(async () => {
    vi.clearAllMocks();
  });

  async function seedOwnerWithBriefing(params: {
    ownerPhone: string;
    priorityType: string;
    localDate?: string;
  }) {
    const ownerId = crypto.randomUUID();
    const hostelId = crypto.randomUUID();

    const email = `owner-${crypto.randomUUID()}@example.com`;
    // 1. Create Owner Profile
    await prisma.$executeRaw`
      INSERT INTO "test"."profiles" (id, email, name, role)
      VALUES (${ownerId}::uuid, ${email}, 'Briefing Owner', 'OWNER')
    `;

    // 2. Create Hostel
    await prisma.$executeRaw`
      INSERT INTO "test"."hostels" (id, owner_id, name, phone, address, is_active)
      VALUES (${hostelId}::uuid, ${ownerId}::uuid, 'Briefing Hostel', '1234567890', '123 Street', true)
    `;

    // 3. Create Verified Owner WhatsApp Identity
    await prisma.$executeRaw`
      INSERT INTO "test"."owner_whatsapp_identities" (id, owner_id, phone_number, is_verified, verified_at, updated_at)
      VALUES (
        ${crypto.randomUUID()}::uuid,
        ${ownerId}::uuid,
        ${params.ownerPhone},
        true,
        now(),
        now()
      )
    `;

    // 4. Create Owner Daily Briefing
    const localDate = params.localDate || "2026-06-12";
    const briefingId = crypto.randomUUID();
    await prisma.$executeRaw`
      INSERT INTO "test"."owner_daily_briefings" (
        id, owner_id, local_date, timezone, template_name, template_version, priority_type,
        priority_payload, template_variables, created_at, updated_at, quick_action_clicks, view_dues_clicks
      )
      VALUES (
        ${briefingId}::uuid,
        ${ownerId}::uuid,
        ${localDate},
        'Asia/Kolkata',
        'owner_daily_briefing_v1',
        1,
        ${params.priorityType},
        '{}'::jsonb,
        '{}'::jsonb,
        now(),
        now(),
        0,
        0
      )
    `;

    return { ownerId, hostelId, briefingId };
  }

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
                  phone_number_id: "1085964934609759"
                },
                contacts: [
                  {
                    profile: { name: "Owner Name" },
                    wa_id: from
                  }
                ],
                messages: [
                  {
                    from,
                    id: `wamid.${crypto.randomUUID()}`,
                    timestamp: String(Math.floor(Date.now() / 1000)),
                    text: { body: bodyText },
                    type: "text"
                  }
                ]
              },
              field: "messages"
            }
          ]
        }
      ]
    };
    return { eventId, payload };
  }

  it("Scenario 1: Fallback if no active context exists", async () => {
    const ownerPhone = "919000000001";
    // We only create verified identity, but NO briefings
    const ownerId = crypto.randomUUID();
    const email = `owner-${crypto.randomUUID()}@example.com`;
    await prisma.$executeRaw`
      INSERT INTO "test"."profiles" (id, email, name, role)
      VALUES (${ownerId}::uuid, ${email}, 'Briefing Owner', 'OWNER')
    `;
    await prisma.$executeRaw`
      INSERT INTO "test"."owner_whatsapp_identities" (id, owner_id, phone_number, is_verified, verified_at, updated_at)
      VALUES (${crypto.randomUUID()}::uuid, ${ownerId}::uuid, ${ownerPhone}, true, now(), now())
    `;

    const { eventId, payload } = makeWebhookPayload(ownerPhone, "⚡ Quick Action");
    const result = await whatsappWebhookEventService.processWebhookEvent(eventId, payload);

    expect(result).toBeDefined();
    expect((result as any).processed_commands).toBe(1);
    const cmdRes = (result as any).command_results[0];
    expect(cmdRes.success).toBe(true);

    expect(mockSendTextMessage).toHaveBeenCalledWith(
      ownerPhone,
      "Sri Adithya Boys Hostel: No active context found. Use the menu commands below to view stats or send reminders."
    );
  });

  it("Scenario 2: Click on View Dues updates counter and handles dues command", async () => {
    const ownerPhone = "919000000002";
    const { briefingId } = await seedOwnerWithBriefing({
      ownerPhone,
      priorityType: "ONBOARDING",
    });

    const { eventId, payload } = makeWebhookPayload(ownerPhone, "⚠️ View Dues");
    const result = await whatsappWebhookEventService.processWebhookEvent(eventId, payload);

    expect(result).toBeDefined();
    expect((result as any).processed_commands).toBe(1);

    // Verify counter is incremented
    const briefing = await prisma.owner_daily_briefings.findUnique({
      where: { id: briefingId },
    });
    expect(briefing?.view_dues_clicks).toBe(1);
    expect(briefing?.quick_action_clicks).toBe(0);

    // Verify response sent dues list
    expect(mockSendListMessage).toHaveBeenCalled();
    const lastListMessage = mockSendListMessage.mock.calls[mockSendListMessage.mock.calls.length - 1][1];
    expect(lastListMessage).toContain("Pending Rent");
  });

  it("Scenario 3: Click on Quick Action for COLLECTIONS triggers collections flow", async () => {
    const ownerPhone = "919000000003";
    const { briefingId } = await seedOwnerWithBriefing({
      ownerPhone,
      priorityType: "COLLECTIONS",
    });

    const { eventId, payload } = makeWebhookPayload(ownerPhone, "⚡ Quick Action");
    const result = await whatsappWebhookEventService.processWebhookEvent(eventId, payload);

    expect(result).toBeDefined();
    expect((result as any).processed_commands).toBe(1);

    // Verify counter is incremented
    const briefing = await prisma.owner_daily_briefings.findUnique({
      where: { id: briefingId },
    });
    expect(briefing?.quick_action_clicks).toBe(1);
    expect(briefing?.view_dues_clicks).toBe(0);

    const lastMessage = mockSendListMessage.mock.calls[mockSendListMessage.mock.calls.length - 1][1];
    expect(lastMessage).toContain("Pending Rent");
    expect(lastMessage).toContain("No pending dues found.");
  });

  it("Scenario 4: Click on Quick Action for ONBOARDING resolves active invites", async () => {
    const ownerPhone = "919000000004";
    const { ownerId, hostelId, briefingId } = await seedOwnerWithBriefing({
      ownerPhone,
      priorityType: "ONBOARDING",
    });

    // Seed a room
    const roomId = crypto.randomUUID();
    await prisma.$executeRaw`
      INSERT INTO "test"."rooms" (id, hostel_id, room_no, base_rent, capacity, is_active)
      VALUES (${roomId}::uuid, ${hostelId}::uuid, '101', 5000, 2, true)
    `;

    // Seed an invited tenant
    const profileId = crypto.randomUUID();
    const tenantId = crypto.randomUUID();
    const tenantEmail = `invited-${crypto.randomUUID()}@example.com`;
    const tenantPhone = `91${crypto.randomInt(9000000000, 9999999999)}`;
    await prisma.$executeRaw`
      INSERT INTO "test"."profiles" (id, email, name, phone, role)
      VALUES (${profileId}::uuid, ${tenantEmail}, 'Invited Tenant', ${tenantPhone}, 'TENANT')
    `;
    await prisma.$executeRaw`
      INSERT INTO "test"."tenants" (id, profile_id, hostel_id, owner_id, status, phone_1, guardian_name, joined_on)
      VALUES (${tenantId}::uuid, ${profileId}::uuid, ${hostelId}::uuid, ${ownerId}::uuid, 'INVITED'::"TenantStatus", ${tenantPhone}, 'Guardian Name', '2026-06-01'::date)
    `;
    // Seed a tenant invitation linked to the room
    const invitationId = crypto.randomUUID();
    await prisma.$executeRaw`
      INSERT INTO "test"."tenant_invitations" (id, tenant_id, owner_id, hostel_id, room_id, name, phone, status, expires_at, token)
      VALUES (${invitationId}::uuid, ${tenantId}::uuid, ${ownerId}::uuid, ${hostelId}::uuid, ${roomId}::uuid, 'Invited Tenant', ${tenantPhone}, 'PENDING', now() + interval '24 hours', 'test-token-12345')
    `;

    const { eventId, payload } = makeWebhookPayload(ownerPhone, "⚡ Quick Action");
    const result = await whatsappWebhookEventService.processWebhookEvent(eventId, payload);

    expect(result).toBeDefined();
    expect((result as any).processed_commands).toBe(1);

    // Verify counter is incremented
    const briefing = await prisma.owner_daily_briefings.findUnique({
      where: { id: briefingId },
    });
    expect(briefing?.quick_action_clicks).toBe(1);

    // Verify message has "Pending Invitations" and sections have "Invited Tenant"
    const calls = mockSendListMessage.mock.calls;
    const lastCall = calls[calls.length - 1];
    expect(lastCall[1]).toContain("Pending Invitations");
    const sectionsJson = JSON.stringify(lastCall[2]);
    expect(sectionsJson).toContain("Invited Tenant");
  });

  it("Scenario 5: Click on Quick Action for HEALTHY priority returns placeholder response", async () => {
    const ownerPhone = "919000000005";
    const { briefingId } = await seedOwnerWithBriefing({
      ownerPhone,
      priorityType: "HEALTHY",
    });

    const { eventId, payload } = makeWebhookPayload(ownerPhone, "⚡ Quick Action");
    const result = await whatsappWebhookEventService.processWebhookEvent(eventId, payload);

    expect(result).toBeDefined();
    expect((result as any).processed_commands).toBe(1);

    const briefing = await prisma.owner_daily_briefings.findUnique({
      where: { id: briefingId },
    });
    expect(briefing?.quick_action_clicks).toBe(1);

    const lastMessage = mockSendTextMessage.mock.calls[mockSendTextMessage.mock.calls.length - 1][1];
    expect(lastMessage).toContain("Everything is running smoothly. Your hostels are healthy with no urgent actions required.");
  });

  it("Scenario 6: Click on Quick Action for OCCUPANCY details bed vacancy stats", async () => {
    const ownerPhone = "919000000006";
    const { ownerId, hostelId, briefingId } = await seedOwnerWithBriefing({
      ownerPhone,
      priorityType: "OCCUPANCY",
    });

    // Seed a room to satisfy getVacancySummary query
    const roomId = crypto.randomUUID();
    await prisma.$executeRaw`
      INSERT INTO "test"."rooms" (id, hostel_id, room_no, base_rent, capacity, is_active)
      VALUES (${roomId}::uuid, ${hostelId}::uuid, '101', 5000, 4, true)
    `;

    const { eventId, payload } = makeWebhookPayload(ownerPhone, "⚡ Quick Action");
    const result = await whatsappWebhookEventService.processWebhookEvent(eventId, payload);

    expect(result).toBeDefined();
    expect((result as any).processed_commands).toBe(1);

    const lastMessage = mockSendListMessage.mock.calls[mockSendListMessage.mock.calls.length - 1][1];
    expect(lastMessage).toContain("Empty Beds");
    expect(lastMessage).toContain("Briefing Hostel");
    expect(lastMessage).toContain("4 Vacant Beds");
  });

  it("Scenario 7: Click on Quick Action for PROFITABILITY details expense review", async () => {
    const ownerPhone = "919000000007";
    const { ownerId, briefingId } = await seedOwnerWithBriefing({
      ownerPhone,
      priorityType: "PROFITABILITY",
    });

    vi.spyOn(dashboardService, "getOwnerStatsShell").mockResolvedValue({
      occupied_rooms: 10,
      total_rooms: 12,
      occupied_beds: 16,
      total_capacity: 20,
      occupancy_rate: 80,
      vacant_beds: 4,
      revenue: 84500,
      monthly_expenses: 32000,
      intelligence: {
        expenses: {
          categories: [
            { category: "Food", amount: 15000 },
            { category: "Maintenance", amount: 8000 },
            { category: "Utilities", amount: 6000 },
          ],
        },
      },
    } as any);

    const { eventId, payload } = makeWebhookPayload(ownerPhone, "⚡ Quick Action");
    const result = await whatsappWebhookEventService.processWebhookEvent(eventId, payload);

    expect(result).toBeDefined();
    expect((result as any).processed_commands).toBe(1);

    const lastMessage = mockSendButtonMessage.mock.calls[mockSendButtonMessage.mock.calls.length - 1][1];
    expect(lastMessage).toContain("Expense review");
    expect(lastMessage).toContain("This is better handled in HMS.");
  });

  it("Scenario 8: Click on Quick Action for OPERATIONS details move-out requests", async () => {
    const ownerPhone = "919000000008";
    const { ownerId, hostelId, briefingId } = await seedOwnerWithBriefing({
      ownerPhone,
      priorityType: "OPERATIONS",
    });

    // Seed a move-out request
    const profileId = crypto.randomUUID();
    const tenantId = crypto.randomUUID();
    const moveOutId = crypto.randomUUID();
    const tenantEmail = `moveout-${crypto.randomUUID()}@example.com`;
    const tenantPhone = `91${crypto.randomInt(9000000000, 9999999999)}`;
    await prisma.$executeRaw`
      INSERT INTO "test"."profiles" (id, email, name, phone, role)
      VALUES (${profileId}::uuid, ${tenantEmail}, 'Rahul', ${tenantPhone}, 'TENANT')
    `;
    await prisma.$executeRaw`
      INSERT INTO "test"."tenants" (id, profile_id, hostel_id, owner_id, status, phone_1, guardian_name, joined_on)
      VALUES (${tenantId}::uuid, ${profileId}::uuid, ${hostelId}::uuid, ${ownerId}::uuid, 'ACTIVE'::"TenantStatus", ${tenantPhone}, 'Guardian Name', '2026-06-01'::date)
    `;
    await prisma.$executeRaw`
      INSERT INTO "test"."move_out_requests" (id, tenant_id, hostel_id, owner_id, status, reason, planned_exit_date, initiated_by)
      VALUES (${moveOutId}::uuid, ${tenantId}::uuid, ${hostelId}::uuid, ${ownerId}::uuid, 'REQUESTED'::"MoveOutStatus", 'PERSONAL_REASONS'::"MoveOutReason", '2026-06-12'::date, ${tenantId}::uuid)
    `;

    const { eventId, payload } = makeWebhookPayload(ownerPhone, "⚡ Quick Action");
    const result = await whatsappWebhookEventService.processWebhookEvent(eventId, payload);

    expect(result).toBeDefined();
    expect((result as any).processed_commands).toBe(1);

    const calls = mockSendListMessage.mock.calls;
    const lastCall = calls[calls.length - 1];
    expect(lastCall[1]).toContain("Move-Outs");
    expect(lastCall[1]).toContain("Action Needed: 1");
    const sectionsJson = JSON.stringify(lastCall[2]);
    expect(sectionsJson).toContain("Rahul");
  });
});
