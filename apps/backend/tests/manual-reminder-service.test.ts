import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findTenant: vi.fn(),
  findObligation: vi.fn(),
  createReminderLog: vi.fn(),
  getTenantContext: vi.fn(),
  triggerEvent: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    tenants: { findFirst: mocks.findTenant },
    rent_obligations: { findFirst: mocks.findObligation },
    reminder_logs: { create: mocks.createReminderLog },
  },
}));

vi.mock("@/lib/hostel-context", () => ({
  batchGetHostelContexts: vi.fn(),
  getTenantOperationalContext: mocks.getTenantContext,
}));

vi.mock("@/lib/events", () => ({
  eventSystem: { trigger: mocks.triggerEvent },
}));

vi.mock("@/lib/services/email-service", () => ({
  EmailService: { sendReminderBatch: vi.fn() },
}));

vi.mock("@/lib/services/event-log-service", () => ({
  eventLog: { log: vi.fn() },
}));

vi.mock("@/lib/services/notifications/whatsapp-reminder-delivery", () => ({
  whatsappReminderDeliveryService: { sendRentReminder: vi.fn() },
}));

vi.mock("@/lib/logger", () => ({
  getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { ReminderService } from "@/src/services/payments/reminder-service";

describe("ReminderService.sendManualReminder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findTenant.mockResolvedValue({
      id: "9ea72900-bc1d-4c32-8954-f917d9177050",
      owner_id: "c39676a0-c867-4435-9660-a060b8bceab6",
      hostel_id: "11111111-1111-1111-1111-111111111111",
      personal_email: null,
      profiles: { name: "Harsha", phone: "917901070333" },
    });
    mocks.findObligation.mockResolvedValue({
      id: "22222222-2222-2222-2222-222222222222",
      tenant_id: "9ea72900-bc1d-4c32-8954-f917d9177050",
      owner_id: "c39676a0-c867-4435-9660-a060b8bceab6",
      hostel_id: "11111111-1111-1111-1111-111111111111",
      amount: 8100,
      due_date: new Date("2026-06-01T00:00:00.000Z"),
      rent_month: new Date("2026-06-01T00:00:00.000Z"),
    });
    mocks.getTenantContext.mockResolvedValue({
      hostel: { id: "11111111-1111-1111-1111-111111111111", name: "Sri Adithya Boys Hostel-1" },
      prefs: { reminder_in_app: true, reminder_email: false, reminder_whatsapp: false },
    });
    mocks.createReminderLog.mockResolvedValue({ id: "log-1" });
  });

  it("uses the current profiles relation and records the owner reminder", async () => {
    const result = await new ReminderService().sendManualReminder(
      "9ea72900-bc1d-4c32-8954-f917d9177050",
      "c39676a0-c867-4435-9660-a060b8bceab6",
    );

    expect(mocks.findTenant).toHaveBeenCalledWith({
      where: {
        id: "9ea72900-bc1d-4c32-8954-f917d9177050",
        owner_id: "c39676a0-c867-4435-9660-a060b8bceab6",
        status: "ACTIVE",
      },
      select: {
        id: true,
        personal_email: true,
        owner_id: true,
        hostel_id: true,
        profiles: { select: { name: true, phone: true } },
      },
    });
    expect(result).toMatchObject({ sent: 1, tenant_name: "Harsha" });
    expect(mocks.createReminderLog).toHaveBeenCalledOnce();
  });
});
