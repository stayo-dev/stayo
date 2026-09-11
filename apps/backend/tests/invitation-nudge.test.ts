import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * "Nudge on WhatsApp" on an imported resident answered: "Cannot edit or resend
 * invitation after payments have been recorded for this tenant".
 *
 * The nudge went through `resendInvitation`, which regenerates the tenant's
 * dues — correctly refused once payments exist, and an imported resident's
 * paid-up months are payments from the moment they are imported. A nudge is
 * the same link again; it now never goes near money.
 */

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  findUnique: vi.fn(),
  txInvitationUpdate: vi.fn(),
  txReservationsUpdateMany: vi.fn(),
  txObligationsDeleteMany: vi.fn(),
  paymentsCount: vi.fn(),
  profileFindUnique: vi.fn(),
  recordWhatsAppDelivery: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    tenant_invitations: { findFirst: mocks.findFirst, findUnique: mocks.findUnique },
    payments: { count: mocks.paymentsCount },
    profile: { findUnique: mocks.profileFindUnique },
    $transaction: vi.fn(async (fn: any) =>
      fn({
        tenant_invitations: { update: mocks.txInvitationUpdate },
        tenant_invitation_reservations: { updateMany: mocks.txReservationsUpdateMany },
        rent_obligations: { deleteMany: mocks.txObligationsDeleteMany },
      })
    ),
  },
}));
vi.mock("@/lib/services/event-log-service", () => ({ eventLog: { log: vi.fn() } }));
vi.mock("@/lib/services/room-capacity-service", () => ({ roomCapacityService: {} }));
vi.mock("@/lib/services/email-service", () => ({ EmailService: { sendInvitation: vi.fn() } }));
vi.mock("@/src/services/tenants/invitation-delivery-trust", async (importOriginal) => ({
  ...(await importOriginal<any>()),
  recordWhatsAppDelivery: mocks.recordWhatsAppDelivery,
}));

import {
  TenantInvitationLifecycleService,
  changesInvitationTerms,
} from "@/src/services/tenants/tenant-invitation-lifecycle-service";

const invitation = (over: any = {}) => ({
  id: "inv-1",
  owner_id: "owner-1",
  tenant_id: "tenant-1",
  phone: "+918008046952",
  email: null,
  token: "token-abc",
  status: "PENDING",
  tenant: { id: "tenant-1", status: "ACTIVE", monthly_rent: 8500 },
  room: { id: "room-401", room_no: "401", hostels: { name: "Sri Adithya Boys Hostel", status: "ACTIVE" } },
  ...over,
});

let service: any;
let delivery: any;

beforeEach(() => {
  vi.clearAllMocks();
  service = new TenantInvitationLifecycleService();
  delivery = { whatsapp_sent: true, email_sent: false };
  vi.spyOn(service, "dispatchInvitationNotification").mockImplementation(async () => delivery);
  vi.spyOn(service, "resendInvitation").mockResolvedValue({ via: "full-resend" });
  mocks.findFirst.mockResolvedValue(invitation());
  mocks.findUnique.mockResolvedValue(invitation());
  mocks.txInvitationUpdate.mockImplementation(async ({ data }: any) => ({ ...invitation(), ...data }));
  mocks.profileFindUnique.mockResolvedValue({ id: "owner-1", name: "Owner" });
  // The owner's tenant: ₹76,500 already paid, recorded at import.
  mocks.paymentsCount.mockResolvedValue(3);
});

const nudge = (overrides: any = {}) =>
  service.resendInvitationByEmail("+918008046952", { id: "owner-1", role: "OWNER" }, { identifier: "+918008046952", ...overrides });

describe("nudging a tenant who has payments on record", () => {
  it("sends the same link again instead of refusing", async () => {
    const result = await nudge();

    expect(service.resendInvitation).not.toHaveBeenCalled();
    expect(service.dispatchInvitationNotification).toHaveBeenCalledTimes(1);
    expect(result.activation_link).toContain("/activate/token-abc");
    expect(result.whatsapp_sent).toBe(true);
  });

  /** The reason the full resend refuses — and the reason this may not. */
  it("never touches the tenant's dues", async () => {
    await nudge();

    expect(mocks.txObligationsDeleteMany).not.toHaveBeenCalled();
    expect(mocks.paymentsCount).not.toHaveBeenCalled();
  });

  it("keeps the same invitation, so links already sent still work", async () => {
    await nudge();

    expect(mocks.txInvitationUpdate).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "inv-1" } }));
    const data = mocks.txInvitationUpdate.mock.calls[0][0].data;
    expect(data).not.toHaveProperty("token");
  });

  it("gives the tenant a fresh week, and holds their bed as long", async () => {
    await nudge();

    const expires = mocks.txInvitationUpdate.mock.calls[0][0].data.expires_at as Date;
    const days = (expires.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.9);
    expect(mocks.txReservationsUpdateMany).toHaveBeenCalledWith({
      where: { invitation_id: "inv-1", status: "ACTIVE" },
      data: { expires_at: expires },
    });
  });

  it("reports honestly when WhatsApp didn't take it", async () => {
    delivery = { whatsapp_sent: false, email_sent: false, whatsapp_error: "(#131030) not in allowed list", needs_email: true };

    const result = await nudge();

    expect(result.whatsapp_sent).toBe(false);
    expect(result.whatsapp_error).toContain("131030");
    expect(mocks.recordWhatsAppDelivery).toHaveBeenCalledWith("inv-1", false);
  });

  it("records an owner-supplied fallback email for delivery", async () => {
    await nudge({ email: "Ravi@Gmail.com" });

    expect(mocks.txInvitationUpdate.mock.calls[0][0].data.email).toBe("ravi@gmail.com");
    expect(service.resendInvitation).not.toHaveBeenCalled();
  });

  it("never stores the placeholder as a fallback address", async () => {
    await nudge({ email: "+918008046952@hms.temp" });

    expect(mocks.txInvitationUpdate.mock.calls[0][0].data).not.toHaveProperty("email");
  });

  it("sends a queued import invitation that was never sent", async () => {
    mocks.findUnique.mockResolvedValue(invitation({ status: "QUEUED" }));

    await nudge();

    expect(mocks.txInvitationUpdate.mock.calls[0][0].data.status).toBe("PENDING");
  });
});

describe("what a nudge must still refuse", () => {
  /** The expiry sweep freed the room and voided the dues. No working link back. */
  it("leaves an invitation the sweep closed to the full path", async () => {
    mocks.findFirst.mockResolvedValue(invitation({ status: "EXPIRED" }));

    await nudge();

    expect(service.resendInvitation).toHaveBeenCalled();
    expect(service.dispatchInvitationNotification).not.toHaveBeenCalled();
  });

  it("refuses a tenancy that has ended", async () => {
    mocks.findUnique.mockResolvedValue(invitation({ tenant: { id: "tenant-1", status: "MOVED_OUT" } }));

    await expect(nudge()).rejects.toThrow("tenancy has ended");
  });

  it("refuses another owner's invitation", async () => {
    mocks.findUnique.mockResolvedValue(invitation({ owner_id: "owner-2" }));

    await expect(nudge()).rejects.toThrow("FORBIDDEN");
  });

  /** Changing the offer is an edit, and edits keep the payment lock. */
  it("sends a change to the terms through the full path, lock and all", async () => {
    await nudge({ monthly_rent: 9000 });

    expect(service.resendInvitation).toHaveBeenCalled();
    expect(service.dispatchInvitationNotification).not.toHaveBeenCalled();
  });
});

describe("telling a nudge from an edit", () => {
  const inv = { phone: "+918008046952" };

  it("treats the identifier-and-email body as a nudge", () => {
    expect(changesInvitationTerms({ identifier: "+918008046952" }, inv)).toBe(false);
    expect(changesInvitationTerms({ identifier: "x", email: "ravi@gmail.com" }, inv)).toBe(false);
  });

  it("treats the invitation's own phone as an identifier, not an edit", () => {
    expect(changesInvitationTerms({ phone: "8008046952" }, inv)).toBe(false);
  });

  it.each([
    [{ phone: "9876500001" }],
    [{ room_id: "room-2" }],
    [{ monthly_rent: 9000 }],
    [{ advance_amount: 20000 }],
    [{ joining_date: "2026-02-01" }],
  ])("treats %o as an edit", (overrides) => {
    expect(changesInvitationTerms(overrides, inv)).toBe(true);
  });
});
