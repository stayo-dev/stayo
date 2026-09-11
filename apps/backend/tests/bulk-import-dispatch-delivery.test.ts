import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * "Send all" must report what actually reached the tenants.
 *
 * An owner imported a tenant, pressed Send, and the screen said "Every
 * invitation has been sent" — while no WhatsApp arrived. `dispatchQueuedInvitations`
 * counted every invitation it moved out of the queue as sent, and threw the
 * delivery result (the WhatsApp error included) away. These tests run the
 * real method with delivery stubbed at the one seam that talks to providers.
 */

const mocks = vi.hoisted(() => ({
  invitationsFindMany: vi.fn(),
  invitationsUpdateMany: vi.fn(),
  invitationsFindUniqueOrThrow: vi.fn(),
  invitationsCount: vi.fn(),
  profileFindUnique: vi.fn(),
  tenantsFindUnique: vi.fn(),
  roomsFindUnique: vi.fn(),
  reservationsUpdateMany: vi.fn(),
  recordWhatsAppDelivery: vi.fn(),
  sendInvitationEmail: vi.fn(),
  whatsappSendInvitation: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    tenant_invitations: {
      findMany: mocks.invitationsFindMany,
      updateMany: mocks.invitationsUpdateMany,
      findUniqueOrThrow: mocks.invitationsFindUniqueOrThrow,
      count: mocks.invitationsCount,
    },
    profile: { findUnique: mocks.profileFindUnique },
    tenants: { findUnique: mocks.tenantsFindUnique },
    rooms: { findUnique: mocks.roomsFindUnique, findMany: vi.fn().mockResolvedValue([]) },
    tenant_invitation_reservations: { updateMany: mocks.reservationsUpdateMany },
    roomAllocation: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));
vi.mock("@/lib/services/event-log-service", () => ({ eventLog: { log: vi.fn() } }));
vi.mock("@/lib/services/room-capacity-service", () => ({ roomCapacityService: {} }));
vi.mock("@/lib/services/email-service", () => ({ EmailService: { sendInvitation: mocks.sendInvitationEmail } }));
vi.mock("@/src/services/tenants/invitation-delivery-trust", async (importOriginal) => ({
  ...(await importOriginal<any>()),
  recordWhatsAppDelivery: mocks.recordWhatsAppDelivery,
}));
vi.mock("@/lib/services/notifications/providers/whatsapp/meta-provider", () => ({
  MetaWhatsAppProvider: class {
    sendInvitation = mocks.whatsappSendInvitation;
  },
}));

import { TenantInvitationLifecycleService } from "@/src/services/tenants/tenant-invitation-lifecycle-service";

const invitation = (id: string, over: any = {}) => ({
  id,
  owner_id: "owner-1",
  tenant_id: `tenant-${id}`,
  room_id: "room-1",
  name: `Tenant ${id}`,
  phone: "+918008046952",
  email: null,
  token: `token-${id}`,
  status: "QUEUED",
  ...over,
});

let service: TenantInvitationLifecycleService;

beforeEach(() => {
  vi.clearAllMocks();
  service = new TenantInvitationLifecycleService();
  mocks.invitationsFindMany.mockResolvedValue([invitation("a")]);
  mocks.invitationsUpdateMany.mockResolvedValue({ count: 1 });
  mocks.invitationsFindUniqueOrThrow.mockImplementation(async ({ where }: any) =>
    invitation(where.id, { status: "PENDING" })
  );
  mocks.invitationsCount.mockResolvedValue(0);
  mocks.profileFindUnique.mockResolvedValue({ id: "owner-1", name: "Owner" });
  mocks.tenantsFindUnique.mockResolvedValue({ id: "tenant-a", status: "INVITED", monthly_rent: 8500 });
  mocks.roomsFindUnique.mockResolvedValue({ id: "room-1", room_no: "401", hostels: { name: "Sri Adithya Boys Hostel" } });
  mocks.reservationsUpdateMany.mockResolvedValue({ count: 1 });
  mocks.whatsappSendInvitation.mockResolvedValue({ providerMessageId: "wamid.1" });
  mocks.sendInvitationEmail.mockResolvedValue({ sent: true });
});

describe("sending queued invitations", () => {
  it("counts an invitation WhatsApp delivered as sent", async () => {
    const result = await service.dispatchQueuedInvitations("owner-1");

    expect(result.sent).toBe(1);
    expect(result.undelivered).toEqual([]);
  });

  /** The owner's case: nothing arrived, and the screen said it had. */
  it("does not count one that reached nobody", async () => {
    mocks.whatsappSendInvitation.mockRejectedValue(new Error("(#131030) Recipient phone number not in allowed list"));

    const result = await service.dispatchQueuedInvitations("owner-1");

    expect(result.sent).toBe(0);
    expect(result.undelivered).toHaveLength(1);
  });

  it("says why, in the provider's words — the only diagnosis there is", async () => {
    mocks.whatsappSendInvitation.mockRejectedValue(new Error("(#131030) Recipient phone number not in allowed list"));

    const result = await service.dispatchQueuedInvitations("owner-1");

    expect(result.undelivered[0].reason).toContain("131030");
  });

  it("hands back the link, so the owner can share it themselves", async () => {
    mocks.whatsappSendInvitation.mockRejectedValue(new Error("boom"));

    const result = await service.dispatchQueuedInvitations("owner-1");

    expect(result.undelivered[0]).toMatchObject({
      invitation_id: "a",
      name: "Tenant a",
      phone: "+918008046952",
    });
    expect(result.undelivered[0].activation_link).toContain("/activate/token-a");
  });

  it("counts an email fallback as delivered", async () => {
    mocks.whatsappSendInvitation.mockRejectedValue(new Error("boom"));
    mocks.invitationsFindUniqueOrThrow.mockResolvedValue(invitation("a", { status: "PENDING", email: "ravi@gmail.com" }));

    const result = await service.dispatchQueuedInvitations("owner-1");

    expect(mocks.sendInvitationEmail).toHaveBeenCalledWith(expect.objectContaining({ toEmail: "ravi@gmail.com" }));
    expect(result.sent).toBe(1);
  });

  /**
   * `<phone>@hms.temp` is a storage key for a NOT NULL column, not a mailbox.
   * Falling back to it reported an invitation "sent by email" that could never
   * arrive — and an invitation row had picked one up in production.
   */
  it("never emails a placeholder address", async () => {
    mocks.whatsappSendInvitation.mockRejectedValue(new Error("boom"));
    mocks.invitationsFindUniqueOrThrow.mockResolvedValue(
      invitation("a", { status: "PENDING", email: "+918008046952@hms.temp" })
    );

    const result = await service.dispatchQueuedInvitations("owner-1");

    expect(mocks.sendInvitationEmail).not.toHaveBeenCalled();
    expect(result.sent).toBe(0);
    expect(result.undelivered).toHaveLength(1);
  });
});
