import { describe, expect, it, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { whatsappWebhookEventService } from "@/lib/services/notifications/whatsapp-webhook-event-service";
import { MetaWhatsAppProvider } from "@/lib/services/notifications/providers/whatsapp/meta-provider";
import { setSelectionState, getSelectionState, deleteSelectionState } from "@/lib/services/notifications/whatsapp-selection-state";
import { rateLimitService } from "@/lib/services/rate-limit-service";
import crypto from "crypto";

// Spy on Meta WhatsApp Provider to mock network requests while keeping it constructible
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

vi.spyOn(MetaWhatsAppProvider.prototype, "sendButtonMessage").mockResolvedValue({
  providerMessageId: "mock-button-id-12345",
  raw: { success: true },
  attempts: 1,
});

vi.spyOn(MetaWhatsAppProvider.prototype, "sendListMessage").mockResolvedValue({
  providerMessageId: "mock-list-id-12345",
  raw: { success: true },
  attempts: 1,
});

const rateLimits = new Map<string, number>();
vi.spyOn(rateLimitService, "checkStatelessLimit").mockImplementation(async ({ identifier }) => {
  const now = Date.now();
  const lastTime = rateLimits.get(identifier) || 0;
  if (now - lastTime < 10000) {
    return { allowed: false, attemptsRemaining: 0, retryAfterSeconds: 60 };
  }
  rateLimits.set(identifier, now);
  return { allowed: true, attemptsRemaining: 1 };
});

describe("WhatsApp Balance Command Integration Tests", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    // Clean tables before each run (Cascade will clean related entries)
    await prisma.$executeRaw`TRUNCATE TABLE "test"."profiles" CASCADE`;
  });

  async function seedTestData(params: {
    tenantPhone: string;
    tenantStatus: "ACTIVE" | "INVITED" | "FORMER_TENANT" | "CANCELLED" | "EXPIRED";
    guardianPhone?: string;
  }) {
    const ownerId = crypto.randomUUID();
    const hostelId = crypto.randomUUID();
    const profileId = crypto.randomUUID();
    const tenantId = crypto.randomUUID();
    const roomId = crypto.randomUUID();
    const allocationId = crypto.randomUUID();

    // 1. Create Owner Profile
    await prisma.$executeRaw`
      INSERT INTO "test"."profiles" (id, email, name, role)
      VALUES (${ownerId}::uuid, 'owner@example.com', 'Hostel Owner', 'OWNER')
    `;

    // 2. Create Hostel
    await prisma.$executeRaw`
      INSERT INTO "test"."hostels" (id, owner_id, name, phone, address)
      VALUES (${hostelId}::uuid, ${ownerId}::uuid, 'Test Luxury Living', '1234567890', '123 Street')
    `;

    // 3. Create Tenant Profile
    await prisma.$executeRaw`
      INSERT INTO "test"."profiles" (id, email, name, phone, role)
      VALUES (${profileId}::uuid, 'tenant@example.com', 'Shivaprakash', ${params.tenantPhone}, 'TENANT')
    `;

    // 4. Create Tenant
    await prisma.$executeRaw`
      INSERT INTO "test"."tenants" (id, profile_id, hostel_id, owner_id, status, phone_1, guardian_name, guardian_phone, joined_on)
      VALUES (
        ${tenantId}::uuid,
        ${profileId}::uuid,
        ${hostelId}::uuid,
        ${ownerId}::uuid,
        ${params.tenantStatus}::"TenantStatus",
        ${params.tenantPhone},
        'Guardian Shiva',
        ${params.guardianPhone || null},
        '2025-02-01'::date
      )
    `;

    // 5. Create Room
    await prisma.$executeRaw`
      INSERT INTO "test"."rooms" (id, hostel_id, room_no, capacity)
      VALUES (${roomId}::uuid, ${hostelId}::uuid, '101A', 2)
    `;

    // 6. Create Room Allocation
    await prisma.$executeRaw`
      INSERT INTO "test"."room_allocations" (id, tenant_id, room_id, hostel_id, start_date, end_date, is_active)
      VALUES (
        ${allocationId}::uuid,
        ${tenantId}::uuid,
        ${roomId}::uuid,
        ${hostelId}::uuid,
        '2025-02-01'::date,
        '2026-01-31'::date,
        true
      )
    `;

    // 7. Create Rent Obligations (Billed 120,000, Paid 100,000, Outstanding 20,000)
    const ob1Id = crypto.randomUUID();
    const ob2Id = crypto.randomUUID();

    // Obligation 1: Paid (100,000)
    await prisma.$executeRaw`
      INSERT INTO "test"."rent_obligations" (id, tenant_id, owner_id, hostel_id, allocation_id, rent_month, due_date, amount, total_amount, status, is_superseded)
      VALUES (
        ${ob1Id}::uuid,
        ${tenantId}::uuid,
        ${ownerId}::uuid,
        ${hostelId}::uuid,
        ${allocationId}::uuid,
        '2025-02-01'::date,
        '2025-02-05'::date,
        100000,
        100000,
        'PAID',
        false
      )
    `;

    const payId = crypto.randomUUID();
    await prisma.$executeRaw`
      INSERT INTO "test"."payments" (id, tenant_id, owner_id, hostel_id, obligation_id, amount_paid, payment_date, payment_method, reference_number)
      VALUES (
        ${payId}::uuid,
        ${tenantId}::uuid,
        ${ownerId}::uuid,
        ${hostelId}::uuid,
        ${ob1Id}::uuid,
        100000,
        '2025-02-04'::date,
        'UPI',
        'TXN123456789'
      )
    `;

    // Obligation 2: Unpaid (20,000)
    await prisma.$executeRaw`
      INSERT INTO "test"."rent_obligations" (id, tenant_id, owner_id, hostel_id, allocation_id, rent_month, due_date, amount, total_amount, status, is_superseded)
      VALUES (
        ${ob2Id}::uuid,
        ${tenantId}::uuid,
        ${ownerId}::uuid,
        ${hostelId}::uuid,
        ${allocationId}::uuid,
        '2025-03-01'::date,
        '2025-03-05'::date,
        20000,
        20000,
        'PENDING',
        false
      )
    `;

    return { tenantId, ownerId, hostelId };
  }

  async function seedMultiTenantData(params: {
    guardianPhone: string;
    tenants: Array<{ name: string; roomNo: string }>;
  }) {
    const ownerId = crypto.randomUUID();
    const hostelId = crypto.randomUUID();
    const tenantIds: string[] = [];

    // Create Owner Profile
    await prisma.$executeRaw`
      INSERT INTO "test"."profiles" (id, email, name, role)
      VALUES (${ownerId}::uuid, ${`owner_${crypto.randomUUID()}@example.com`}, 'Hostel Owner', 'OWNER')
    `;

    // Create Hostel
    await prisma.$executeRaw`
      INSERT INTO "test"."hostels" (id, owner_id, name, phone, address)
      VALUES (${hostelId}::uuid, ${ownerId}::uuid, 'Test Luxury Living', '1234567890', '123 Street')
    `;

    for (let i = 0; i < params.tenants.length; i++) {
      const tenantInfo = params.tenants[i];
      const tenantPhone = `9180000${crypto.randomInt(100000, 999999)}`;
      const profileId = crypto.randomUUID();
      const tenantId = crypto.randomUUID();
      tenantIds.push(tenantId);
      const roomId = crypto.randomUUID();
      const allocationId = crypto.randomUUID();

      // Tenant Profile
      await prisma.$executeRaw`
        INSERT INTO "test"."profiles" (id, email, name, phone, role)
        VALUES (${profileId}::uuid, ${`tenant_${i}_${crypto.randomUUID()}@example.com`}, ${tenantInfo.name}, ${tenantPhone}, 'TENANT')
      `;

      // Tenant (status ACTIVE)
      await prisma.$executeRaw`
        INSERT INTO "test"."tenants" (id, profile_id, hostel_id, owner_id, status, phone_1, guardian_name, guardian_phone, joined_on)
        VALUES (
          ${tenantId}::uuid,
          ${profileId}::uuid,
          ${hostelId}::uuid,
          ${ownerId}::uuid,
          'ACTIVE'::"TenantStatus",
          ${tenantPhone},
          'Guardian Name',
          ${params.guardianPhone},
          '2025-02-01'::date
        )
      `;

      // Room
      await prisma.$executeRaw`
        INSERT INTO "test"."rooms" (id, hostel_id, room_no, capacity)
        VALUES (${roomId}::uuid, ${hostelId}::uuid, ${tenantInfo.roomNo}, 2)
      `;

      // Allocation
      await prisma.$executeRaw`
        INSERT INTO "test"."room_allocations" (id, tenant_id, room_id, hostel_id, start_date, end_date, is_active)
        VALUES (
          ${allocationId}::uuid,
          ${tenantId}::uuid,
          ${roomId}::uuid,
          ${hostelId}::uuid,
          '2025-02-01'::date,
          '2026-01-31'::date,
          true
        )
      `;

      // Rent obligation
      const obId = crypto.randomUUID();
      await prisma.$executeRaw`
        INSERT INTO "test"."rent_obligations" (id, tenant_id, owner_id, hostel_id, allocation_id, rent_month, due_date, amount, total_amount, status, is_superseded)
        VALUES (
          ${obId}::uuid,
          ${tenantId}::uuid,
          ${ownerId}::uuid,
          ${hostelId}::uuid,
          ${allocationId}::uuid,
          '2025-02-01'::date,
          '2025-02-05'::date,
          50000,
          50000,
          'PENDING',
          false
        )
      `;
    }

    return { ownerId, hostelId, tenantIds };
  }

  async function seedMultiTenantDataWithStatus(params: {
    guardianPhone: string;
    tenants: Array<{ name: string; roomNo: string; status?: string }>;
  }) {
    const ownerId = crypto.randomUUID();
    const hostelId = crypto.randomUUID();
    const tenantIds: string[] = [];

    // Create Owner Profile
    await prisma.$executeRaw`
      INSERT INTO "test"."profiles" (id, email, name, role)
      VALUES (${ownerId}::uuid, ${`owner_${crypto.randomUUID()}@example.com`}, 'Hostel Owner', 'OWNER')
    `;

    // Create Hostel
    await prisma.$executeRaw`
      INSERT INTO "test"."hostels" (id, owner_id, name, phone, address)
      VALUES (${hostelId}::uuid, ${ownerId}::uuid, 'Test Luxury Living', '1234567890', '123 Street')
    `;

    for (let i = 0; i < params.tenants.length; i++) {
      const tenantInfo = params.tenants[i];
      const status = tenantInfo.status || "ACTIVE";
      const tenantPhone = `918000000${crypto.randomInt(100000, 999999)}`;
      const profileId = crypto.randomUUID();
      const tenantId = crypto.randomUUID();
      tenantIds.push(tenantId);
      const roomId = crypto.randomUUID();
      const allocationId = crypto.randomUUID();

      // Tenant Profile
      await prisma.$executeRaw`
        INSERT INTO "test"."profiles" (id, email, name, phone, role)
        VALUES (${profileId}::uuid, ${`tenant_${i}_${crypto.randomUUID()}@example.com`}, ${tenantInfo.name}, ${tenantPhone}, 'TENANT')
      `;

      // Tenant (with specific status)
      await prisma.$executeRaw`
        INSERT INTO "test"."tenants" (id, profile_id, hostel_id, owner_id, status, phone_1, guardian_name, guardian_phone, joined_on)
        VALUES (
          ${tenantId}::uuid,
          ${profileId}::uuid,
          ${hostelId}::uuid,
          ${ownerId}::uuid,
          ${status}::"TenantStatus",
          ${tenantPhone},
          'Guardian Name',
          ${params.guardianPhone},
          '2025-02-01'::date
        )
      `;

      // Room
      await prisma.$executeRaw`
        INSERT INTO "test"."rooms" (id, hostel_id, room_no, capacity)
        VALUES (${roomId}::uuid, ${hostelId}::uuid, ${tenantInfo.roomNo}, 2)
      `;

      // Allocation
      await prisma.$executeRaw`
        INSERT INTO "test"."room_allocations" (id, tenant_id, room_id, hostel_id, start_date, end_date, is_active)
        VALUES (
          ${allocationId}::uuid,
          ${tenantId}::uuid,
          ${roomId}::uuid,
          ${hostelId}::uuid,
          '2025-02-01'::date,
          '2026-01-31'::date,
          true
        )
      `;

      // Rent obligation
      const obId = crypto.randomUUID();
      await prisma.$executeRaw`
        INSERT INTO "test"."rent_obligations" (id, tenant_id, owner_id, hostel_id, allocation_id, rent_month, due_date, amount, total_amount, status, is_superseded)
        VALUES (
          ${obId}::uuid,
          ${tenantId}::uuid,
          ${ownerId}::uuid,
          ${hostelId}::uuid,
          ${allocationId}::uuid,
          '2025-02-01'::date,
          '2025-02-05'::date,
          50000,
          50000,
          'PENDING',
          false
        )
      `;
    }

    return { ownerId, hostelId, tenantIds };
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
                    profile: { name: "User Name" },
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

  it("Scenario 1: executes BAL command successfully for active resident and logs SENT audit", async () => {
    const phone = "919000000001";
    const { tenantId, ownerId, hostelId } = await seedTestData({
      tenantPhone: phone,
      tenantStatus: "ACTIVE",
    });

    const { eventId, payload } = makeWebhookPayload(phone, "BAL");

    const result = await whatsappWebhookEventService.processWebhookEvent(eventId, payload);

    expect(result).toBeDefined();
    expect((result as any).processed_commands).toBe(1);

    const cmdRes = (result as any).command_results[0];
    expect(cmdRes.success).toBe(true);
    expect(cmdRes.tenant_id).toBe(tenantId);

    // Verify structured audit log in database
    const logs = await prisma.$queryRaw<any[]>`
      SELECT * FROM "test"."whatsapp_logs"
      WHERE phone = ${phone} AND template_name = 'BAL'
      ORDER BY created_at DESC LIMIT 1
    `;
    expect(logs.length).toBe(1);
    expect(logs[0].status).toBe("SENT");
    expect(logs[0].tenant_id).toBe(tenantId);
    expect(logs[0].owner_id).toBe(ownerId);
    expect(logs[0].hostel_id).toBe(hostelId);

    const auditData = logs[0].provider_response as any;
    expect(auditData.command).toBe("BAL");
    expect(auditData.sender_role).toBe("TENANT");
    expect(auditData.success).toBe(true);
    expect(auditData.template_used).toBe("v2_balance_text");
  });

  it("Scenario 2: executes BALANCE command successfully for guardian of an active resident", async () => {
    const tenantPhone = "919000000002";
    const guardianPhone = "919000000022";
    const { tenantId } = await seedTestData({
      tenantPhone,
      tenantStatus: "ACTIVE",
      guardianPhone,
    });

    const { eventId, payload } = makeWebhookPayload(guardianPhone, "  balance  ");

    const result = await whatsappWebhookEventService.processWebhookEvent(eventId, payload);
    expect(result).toBeDefined();
    expect((result as any).processed_commands).toBe(1);

    const cmdRes = (result as any).command_results[0];
    expect(cmdRes.success).toBe(true);
    expect(cmdRes.tenant_id).toBe(tenantId);

    const logs = await prisma.$queryRaw<any[]>`
      SELECT * FROM "test"."whatsapp_logs"
      WHERE phone = ${guardianPhone} AND template_name = 'BAL'
      ORDER BY created_at DESC LIMIT 1
    `;
    expect(logs.length).toBe(1);
    expect(logs[0].status).toBe("SENT");

    const auditData = logs[0].provider_response as any;
    expect(auditData.sender_role).toBe("GUARDIAN");
    expect(auditData.success).toBe(true);
  });

  it("Scenario 3: denies access if resident has FORMER_TENANT status", async () => {
    const phone = "919000000003";
    await seedTestData({
      tenantPhone: phone,
      tenantStatus: "FORMER_TENANT",
    });

    const { eventId, payload } = makeWebhookPayload(phone, "BAL");

    const result = await whatsappWebhookEventService.processWebhookEvent(eventId, payload);
    expect(result).toBeDefined();
    expect((result as any).processed_commands).toBe(1);

    const cmdRes = (result as any).command_results[0];
    expect(cmdRes.success).toBe(false);
    expect(cmdRes.reason).toBe("UNAUTHORIZED");

    // Verify UNAUTHORIZED response audit log
    const logs = await prisma.$queryRaw<any[]>`
      SELECT * FROM "test"."whatsapp_logs"
      WHERE phone = ${phone} AND template_name = 'BAL'
      ORDER BY created_at DESC LIMIT 1
    `;
    expect(logs.length).toBe(1);
    expect(logs[0].status).toBe("UNAUTHORIZED");
    expect(logs[0].tenant_id).toBeNull();

    const auditData = logs[0].provider_response as any;
    expect(auditData.sender_role).toBe("UNKNOWN");
    expect(auditData.success).toBe(true); // sending the denial text succeeded
    expect(auditData.template_used).toBe("text");
    expect(auditData.failure_reason).toBe("No active tenant found");
  });

  it("Scenario 4: triggers guardian selection workflow if phone number matches multiple active records", async () => {
    const sharedPhone = "919000000004";
    
    // Seed tenant 1 with unique tenant phone but shared guardian phone
    const { ownerId, hostelId } = await seedTestData({
      tenantPhone: "919000000041",
      tenantStatus: "ACTIVE",
      guardianPhone: sharedPhone,
    });

    // Seed tenant 2 sharing the same guardian phone
    const profileId2 = crypto.randomUUID();
    const tenantId2 = crypto.randomUUID();
    await prisma.$executeRaw`
      INSERT INTO "test"."profiles" (id, email, name, phone, role)
      VALUES (${profileId2}::uuid, 'tenant2@example.com', 'Resident Two', '919000000042', 'TENANT')
    `;
    await prisma.$executeRaw`
      INSERT INTO "test"."tenants" (id, profile_id, hostel_id, owner_id, status, phone_1, guardian_phone, joined_on)
      VALUES (
        ${tenantId2}::uuid,
        ${profileId2}::uuid,
        ${hostelId}::uuid,
        ${ownerId}::uuid,
        'ACTIVE'::"TenantStatus",
        '919000000042',
        ${sharedPhone},
        '2025-02-01'::date
      )
    `;

    const { eventId, payload } = makeWebhookPayload(sharedPhone, "BAL");

    const result = await whatsappWebhookEventService.processWebhookEvent(eventId, payload);
    expect(result).toBeDefined();
    expect((result as any).processed_commands).toBe(1);

    const cmdRes = (result as any).command_results[0];
    expect(cmdRes.success).toBe(true);
    expect(cmdRes.reason).toBe("MULTIPLE_MATCHES");
    expect(cmdRes.matches).toBe(2);

    const logs = await prisma.$queryRaw<any[]>`
      SELECT * FROM "test"."whatsapp_logs"
      WHERE phone = ${sharedPhone} AND template_name = 'BAL'
      ORDER BY created_at DESC LIMIT 1
    `;
    expect(logs.length).toBe(1);
    expect(logs[0].status).toBe("MULTIPLE_MATCHES");

    const auditData = logs[0].provider_response as any;
    expect(auditData.state).toBe("selection_pending");
  });

  it("Scenario 5: rate limits multiple requests within 1 minute", async () => {
    const phone = "919000000005";
    await seedTestData({
      tenantPhone: phone,
      tenantStatus: "ACTIVE",
    });

    // 1st request — should succeed
    const req1 = makeWebhookPayload(phone, "BAL");
    const res1 = await whatsappWebhookEventService.processWebhookEvent(req1.eventId, req1.payload);
    expect((res1 as any).command_results[0].success).toBe(true);

    // 2nd request — should be rate limited
    const req2 = makeWebhookPayload(phone, "BAL");
    const res2 = await whatsappWebhookEventService.processWebhookEvent(req2.eventId, req2.payload);
    expect((res2 as any).command_results[0].success).toBe(false);
    expect((res2 as any).command_results[0].reason).toBe("RATE_LIMITED");

    const logs = await prisma.$queryRaw<any[]>`
      SELECT * FROM "test"."whatsapp_logs"
      WHERE phone = ${phone}
      ORDER BY created_at DESC
    `;
    expect(logs.length).toBe(2);
    expect(logs[0].status).toBe("RATE_LIMITED");
  });

  it("Scenario 6: returns standard unauthorized text response for unknown phone number", async () => {
    const unknownPhone = "919000000006";
    const { eventId, payload } = makeWebhookPayload(unknownPhone, "BAL");

    const result = await whatsappWebhookEventService.processWebhookEvent(eventId, payload);
    expect(result).toBeDefined();
    expect((result as any).processed_commands).toBe(1);

    const cmdRes = (result as any).command_results[0];
    expect(cmdRes.success).toBe(false);
    expect(cmdRes.reason).toBe("UNAUTHORIZED");

    const logs = await prisma.$queryRaw<any[]>`
      SELECT * FROM "test"."whatsapp_logs"
      WHERE phone = ${unknownPhone} AND template_name = 'BAL'
      ORDER BY created_at DESC LIMIT 1
    `;
    expect(logs.length).toBe(1);
    expect(logs[0].status).toBe("UNAUTHORIZED");
  });

  it("Scenario 7: Guardian linked to 3 active tenants sends BAL -> receives name list", async () => {
    const guardianPhone = "919111222333";
    const { tenantIds } = await seedMultiTenantData({
      guardianPhone,
      tenants: [
        { name: "Ravi Kumar", roomNo: "G1" },
        { name: "Kiran Kumar", roomNo: "G2" },
        { name: "Sai Kumar", roomNo: "G3" },
      ],
    });

    const { eventId, payload } = makeWebhookPayload(guardianPhone, "BAL");
    const result = await whatsappWebhookEventService.processWebhookEvent(eventId, payload);

    expect((result as any).command_results[0].success).toBe(true);
    expect((result as any).command_results[0].reason).toBe("MULTIPLE_MATCHES");

    // Verify selection state is set
    const state: any = await getSelectionState(guardianPhone);
    expect(state).toBeDefined();
    expect(state?.action).toBe("BALANCE_SELECTION");
    expect(state?.tenantIds.length).toBe(3);
  }, 20000);

  it("Scenario 8: Guardian selects a valid tenant name -> receives template", async () => {
    const guardianPhone = "919222333444";
    const { tenantIds } = await seedMultiTenantData({
      guardianPhone,
      tenants: [
        { name: "Ravi Kumar", roomNo: "G1" },
        { name: "Kiran Kumar", roomNo: "G2" },
        { name: "Sai Kumar", roomNo: "G3" },
      ],
    });

    // Seed the selection state manually
    await setSelectionState(guardianPhone, {
      phone: guardianPhone,
      action: "BALANCE_SELECTION",
      tenantIds,
    });

    const { eventId, payload } = makeWebhookPayload(guardianPhone, "  Kiran Kumar  ");
    const result = await whatsappWebhookEventService.processWebhookEvent(eventId, payload);

    expect((result as any).command_results[0].success).toBe(true);
    expect((result as any).command_results[0].tenant_id).toBe(tenantIds[1]);

    // State should be deleted
    const state = await getSelectionState(guardianPhone);
    expect(state).toBeNull();

    // Verify log
    const logs = await prisma.$queryRaw<any[]>`
      SELECT * FROM "test"."whatsapp_logs"
      WHERE phone = ${guardianPhone} AND status = 'SELECTION_SUCCESS'
      LIMIT 1
    `;
    expect(logs.length).toBe(1);
    expect(logs[0].tenant_id).toBe(tenantIds[1]);
  }, 20000);

  it("Scenario 9: Guardian sends invalid tenant name -> receives list again, state kept active", async () => {
    const guardianPhone = "919333444555";
    const { tenantIds } = await seedMultiTenantData({
      guardianPhone,
      tenants: [
        { name: "Ravi Kumar", roomNo: "G1" },
        { name: "Kiran Kumar", roomNo: "G2" },
      ],
    });

    await setSelectionState(guardianPhone, {
      phone: guardianPhone,
      action: "BALANCE_SELECTION",
      tenantIds,
    });

    const { eventId, payload } = makeWebhookPayload(guardianPhone, "Rahul");
    const result = await whatsappWebhookEventService.processWebhookEvent(eventId, payload);

    expect((result as any).command_results[0].success).toBe(false);
    expect((result as any).command_results[0].reason).toBe("INVALID_SELECTION");

    // State should still be active
    const state: any = await getSelectionState(guardianPhone);
    expect(state).toBeDefined();
    expect(state?.tenantIds.length).toBe(2);

    const logs = await prisma.$queryRaw<any[]>`
      SELECT * FROM "test"."whatsapp_logs"
      WHERE phone = ${guardianPhone} AND status = 'INVALID_SELECTION'
      LIMIT 1
    `;
    expect(logs.length).toBe(1);
  }, 20000);

  it("Scenario 10: Guardian selection expires after 10 minutes -> receives expired notice", async () => {
    const guardianPhone = "919444555666";
    const { tenantIds } = await seedMultiTenantData({
      guardianPhone,
      tenants: [
        { name: "Ravi Kumar", roomNo: "G1" },
      ],
    });

    // Set selection state with past TTL to simulate expiry
    await setSelectionState(guardianPhone, {
      phone: guardianPhone,
      action: "BALANCE_SELECTION",
      tenantIds,
    }, -10); // Expiry in past

    const { eventId, payload } = makeWebhookPayload(guardianPhone, "Ravi Kumar");
    const result = await whatsappWebhookEventService.processWebhookEvent(eventId, payload);

    expect((result as any).command_results[0].success).toBe(false);
    expect((result as any).command_results[0].reason).toBe("EXPIRED_SELECTION");

    // State is deleted
    const state = await getSelectionState(guardianPhone);
    expect(state).toBeNull();
  }, 20000);

  it("Scenario 11: Duplicate tenant names -> ambiguity selection -> room selection", async () => {
    const guardianPhone = "919555666777";
    const { tenantIds } = await seedMultiTenantData({
      guardianPhone,
      tenants: [
        { name: "Ravi Kumar", roomNo: "G1" },
        { name: "Ravi Kumar", roomNo: "A2" },
        { name: "Kiran Kumar", roomNo: "G2" },
      ],
    });

    await setSelectionState(guardianPhone, {
      phone: guardianPhone,
      action: "BALANCE_SELECTION",
      tenantIds,
    });

    // Reply with "Ravi Kumar" (ambiguous)
    const req1 = makeWebhookPayload(guardianPhone, "Ravi Kumar");
    const res1 = await whatsappWebhookEventService.processWebhookEvent(req1.eventId, req1.payload);

    expect((res1 as any).command_results[0].success).toBe(false);
    expect((res1 as any).command_results[0].reason).toBe("AMBIGUOUS_SELECTION");
    expect((res1 as any).command_results[0].matches).toBe(2);

    // State should now contain only the ambiguous tenants (size = 2)
    const state1: any = await getSelectionState(guardianPhone);
    expect(state1?.tenantIds.length).toBe(2);
    expect(state1?.tenantIds).toContain(tenantIds[0]);
    expect(state1?.tenantIds).toContain(tenantIds[1]);

    // Reply with room choice: "Ravi Kumar (Room A2)"
    const req2 = makeWebhookPayload(guardianPhone, "Ravi Kumar (Room A2)");
    const res2 = await whatsappWebhookEventService.processWebhookEvent(req2.eventId, req2.payload);

    expect((res2 as any).command_results[0].success).toBe(true);
    expect((res2 as any).command_results[0].tenant_id).toBe(tenantIds[1]);

    // State is cleaned up
    const state2 = await getSelectionState(guardianPhone);
    expect(state2).toBeNull();
  }, 20000);

  it("Scenario 12: Guardian cannot access unrelated tenant name", async () => {
    const guardianPhone = "919666777888";
    const { tenantIds } = await seedMultiTenantData({
      guardianPhone,
      tenants: [
        { name: "Ravi Kumar", roomNo: "G1" },
      ],
    });

    // Seed unrelated tenant
    const { tenantIds: unrelatedIds } = await seedMultiTenantData({
      guardianPhone: "919999888777",
      tenants: [
        { name: "Secret Tenant", roomNo: "X9" },
      ],
    });

    await setSelectionState(guardianPhone, {
      phone: guardianPhone,
      action: "BALANCE_SELECTION",
      tenantIds, // restricted only to Ravi Kumar
    });

    // Try to reply with "Secret Tenant"
    const { eventId, payload } = makeWebhookPayload(guardianPhone, "Secret Tenant");
    const result = await whatsappWebhookEventService.processWebhookEvent(eventId, payload);

    // Should not match since Secret Tenant ID is not in state.tenantIds
    expect((result as any).command_results[0].success).toBe(false);
    expect((result as any).command_results[0].reason).toBe("INVALID_SELECTION");
  }, 20000);

  it("Scenario 13: Guardian linked to 1 active child and 1 former child -> receives active child's balance immediately", async () => {
    const guardianPhone = "919777888999";
    const { tenantIds } = await seedMultiTenantDataWithStatus({
      guardianPhone,
      tenants: [
        { name: "Son A", roomNo: "G1", status: "ACTIVE" },
        { name: "Son B", roomNo: "G2", status: "FORMER_TENANT" },
      ],
    });

    const sendTextMessageSpy = vi.spyOn(MetaWhatsAppProvider.prototype, "sendTextMessage");

    const { eventId, payload } = makeWebhookPayload(guardianPhone, "BAL");
    const result = await whatsappWebhookEventService.processWebhookEvent(eventId, payload);

    // Should resolve directly to Son A (Active) without prompting multiple selection
    expect((result as any).command_results[0].success).toBe(true);
    expect((result as any).command_results[0].tenant_id).toBe(tenantIds[0]);

    // Verify text message sent
    expect(sendTextMessageSpy).toHaveBeenCalled();
    // Selection state (BALANCE_SELECTION) should NOT exist, but RESIDENT_CONTEXT should
    const state = await getSelectionState(guardianPhone);
    expect(state).toBeDefined();
    expect(state?.action).toBe("RESIDENT_CONTEXT");
    expect((state as any).activeResidentId).toBe(tenantIds[0]);
  }, 20000);

  it("Scenario 14: Guardian linked to 2 active children and 1 cancelled child -> selection list contains only 2 active children", async () => {
    const guardianPhone = "919888999000";
    const { tenantIds } = await seedMultiTenantDataWithStatus({
      guardianPhone,
      tenants: [
        { name: "Son A", roomNo: "G1", status: "ACTIVE" },
        { name: "Son B", roomNo: "G2", status: "INVITED" },
        { name: "Son C", roomNo: "G3", status: "FORMER_TENANT" },
      ],
    });

    const sendButtonMessageSpy = vi.spyOn(MetaWhatsAppProvider.prototype, "sendButtonMessage");

    const { eventId, payload } = makeWebhookPayload(guardianPhone, "BAL");
    const result = await whatsappWebhookEventService.processWebhookEvent(eventId, payload);

    expect((result as any).command_results[0].success).toBe(true);
    expect((result as any).command_results[0].reason).toBe("MULTIPLE_MATCHES");

    // Selection text should list only Son A and Son B, omitting Son C
    expect(sendButtonMessageSpy).toHaveBeenCalledWith(
      guardianPhone,
      expect.stringContaining("Your number is linked to multiple residents."),
      expect.any(Array)
    );

    const buttonsPassed = sendButtonMessageSpy.mock.calls[0][2];
    expect(buttonsPassed).toHaveLength(2);
    expect(buttonsPassed[0].title).toBe("Son A");
    expect(buttonsPassed[1].title).toBe("Son B");

    // State should only contain the 2 active tenant IDs
    const state: any = await getSelectionState(guardianPhone);
    expect(state).toBeDefined();
    expect(state?.tenantIds.length).toBe(2);
    expect(state?.tenantIds).toContain(tenantIds[0]);
    expect(state?.tenantIds).toContain(tenantIds[1]);
    expect(state?.tenantIds).not.toContain(tenantIds[2]);
  }, 20000);

  it("Scenario 15: formatted balance response for 'Payable Now' state", async () => {
    const phone = "919000100001";
    // seedTestData yields 20,000 pending out of 120,000.
    const { tenantId } = await seedTestData({
      tenantPhone: phone,
      tenantStatus: "ACTIVE",
    });

    const sendTextMessageSpy = vi.spyOn(MetaWhatsAppProvider.prototype, "sendTextMessage");

    const { eventId, payload } = makeWebhookPayload(phone, "BAL");
    await whatsappWebhookEventService.processWebhookEvent(eventId, payload);

    expect(sendTextMessageSpy).toHaveBeenCalled();
    const sentText = sendTextMessageSpy.mock.calls[0][1];
    expect(sentText).toContain("OVERDUE");
    expect(sentText).toContain("Outstanding: ₹20,000");
    expect(sentText).toContain("Total Paid: ₹1,00,000");
  }, 20000);

  it("Scenario 16: formatted balance response for 'Nothing Due Right Now' state", async () => {
    const phone = "919000100002";
    const { tenantId, ownerId, hostelId } = await seedTestData({
      tenantPhone: phone,
      tenantStatus: "ACTIVE",
    });

    // Update tenant's monthly rent to 15,000 so contract_total = 15000 * 12 = 180,000
    // total_paid = 120,000, payable_now = 0, future_outstanding = 60,000 > 0.
    await prisma.tenants.update({
      where: { id: tenantId },
      data: { monthly_rent: 15000 },
    });

    // Mark the pending obligation as PAID to transition to "Nothing Due Right Now"
    await prisma.rent_obligations.updateMany({
      where: { tenant_id: tenantId, status: "PENDING" },
      data: { status: "PAID" },
    });

    const sendTextMessageSpy = vi.spyOn(MetaWhatsAppProvider.prototype, "sendTextMessage");

    const { eventId, payload } = makeWebhookPayload(phone, "BAL");
    await whatsappWebhookEventService.processWebhookEvent(eventId, payload);

    expect(sendTextMessageSpy).toHaveBeenCalled();
    const sentText = sendTextMessageSpy.mock.calls[0][1];
    expect(sentText).toContain("ON TRACK");
    expect(sentText).toContain("Outstanding: ₹0");
    expect(sentText).toContain("Status: 🟢 Nothing Due Right Now");
    expect(sentText).toContain("Remaining: ₹80,000");
  }, 20000);

  it("Scenario 17: formatted balance response for 'Fully Settled' state", async () => {
    const phone = "919000100003";
    const { tenantId, ownerId, hostelId } = await seedTestData({
      tenantPhone: phone,
      tenantStatus: "ACTIVE",
    });

    // Mark pending obligations as PAID
    await prisma.rent_obligations.updateMany({
      where: { tenant_id: tenantId, status: "PENDING" },
      data: { status: "PAID" },
    });

    const sendTextMessageSpy = vi.spyOn(MetaWhatsAppProvider.prototype, "sendTextMessage");

    const { eventId, payload } = makeWebhookPayload(phone, "BAL");
    await whatsappWebhookEventService.processWebhookEvent(eventId, payload);

    expect(sendTextMessageSpy).toHaveBeenCalled();
    const sentText = sendTextMessageSpy.mock.calls[0][1];
    expect(sentText).toContain("ON TRACK");
    expect(sentText).toContain("Status: 🟢 Fully Settled");
    expect(sentText).toContain("Outstanding: ₹0");
  }, 20000);
});
