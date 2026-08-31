import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * completeActivation() is fully mocked out of tests/activation-workflow.test.ts
 * (it mocks this whole service module), so it needs its own file to exercise
 * the real implementation. Mirrors tests/agreement-renewal-activation.test.ts's
 * approach for the same shape: a $transaction mock that hands the callback a
 * fake `tx` exposing only the methods completeActivation actually calls.
 */
const mocks = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  executeRaw: vi.fn(),
  reservationFindFirst: vi.fn(),
  reservationUpdate: vi.fn(),
  invitationsUpdate: vi.fn(),
  invitationsFindMany: vi.fn().mockResolvedValue([]),
  profileUpdate: vi.fn(),
  tenantsUpdate: vi.fn(),
  roomAllocationFindFirst: vi.fn().mockResolvedValue(null),
  roomAllocationCreate: vi.fn(),
  visitorLeadUpdateMany: vi.fn().mockResolvedValue({ count: 1 }),
  eventLogLog: vi.fn().mockResolvedValue(undefined),
  getRoomCapacitySnapshot: vi.fn().mockResolvedValue({ occupied: 0, room: { capacity: 4 } }),
  // Only needed by the new createInvitation self-invite-guard tests below —
  // completeActivation's own suite never reaches these.
  roomsFindFirst: vi.fn(),
  profileFindUnique: vi.fn(),
  tenantInvitationsFindFirst: vi.fn(),
  transaction: vi.fn(async (cb: any) =>
    cb({
      $queryRaw: mocks.queryRaw,
      $executeRaw: mocks.executeRaw,
      tenant_invitation_reservations: { findFirst: mocks.reservationFindFirst, update: mocks.reservationUpdate },
      tenant_invitations: { update: mocks.invitationsUpdate, findMany: mocks.invitationsFindMany },
      roomAllocation: { findFirst: mocks.roomAllocationFindFirst, create: mocks.roomAllocationCreate },
      profile: { update: mocks.profileUpdate },
      tenants: { update: mocks.tenantsUpdate },
      visitorLead: { updateMany: mocks.visitorLeadUpdateMany },
    }),
  ),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    $transaction: mocks.transaction,
    rooms: { findFirst: mocks.roomsFindFirst },
    profile: { findUnique: mocks.profileFindUnique },
    tenant_invitations: { findFirst: mocks.tenantInvitationsFindFirst },
  },
}));

vi.mock("@/lib/services/room-capacity-service", () => ({
  roomCapacityService: { getRoomCapacitySnapshot: mocks.getRoomCapacitySnapshot },
}));

vi.mock("@/lib/services/event-log-service", () => ({
  eventLog: { log: mocks.eventLogLog },
}));

vi.mock("@/lib/services/email-service", () => ({
  EmailService: { sendInvitation: vi.fn() },
}));

import { TenantInvitationLifecycleService } from "@/src/services/tenants/tenant-invitation-lifecycle-service";

const TENANT_ID = "tenant-1";
const PROFILE_ID = "profile-1";
const INVITATION_ID = "invitation-1";

const tenantRowActionable = [{ id: TENANT_ID, status: "INVITED", joined_on: null, owner_id: "owner-1" }];
const profileRowFound = [{ id: PROFILE_ID }];
const invitationRowActionable = [{ id: INVITATION_ID, status: "PENDING" }];

function invitation(overrides: any = {}) {
  return {
    id: INVITATION_ID,
    owner_id: "owner-1",
    hostel_id: "hostel-1",
    email: null,
    phone: "9845013001",
    ...overrides,
  };
}

function tenant(overrides: any = {}) {
  return { id: TENANT_ID, owner_id: "owner-1", activation_started_at: null, ...overrides };
}

function profile(overrides: any = {}) {
  return { id: PROFILE_ID, ...overrides };
}

describe("TenantInvitationLifecycleService.completeActivation — JOINED wiring", () => {
  let service: TenantInvitationLifecycleService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new TenantInvitationLifecycleService();
    mocks.invitationsFindMany.mockResolvedValue([]);
    mocks.roomAllocationFindFirst.mockResolvedValue(null);
    mocks.visitorLeadUpdateMany.mockResolvedValue({ count: 1 });
    mocks.getRoomCapacitySnapshot.mockResolvedValue({ occupied: 0, room: { capacity: 4 } });
    mocks.reservationFindFirst.mockResolvedValue({ id: "reservation-1", room_id: "room-1", hostel_id: "hostel-1" });
    mocks.eventLogLog.mockResolvedValue(undefined);
  });

  it("marks the lead JOINED inside the same transaction as the tenant's ACTIVE flip", async () => {
    mocks.queryRaw
      .mockResolvedValueOnce(tenantRowActionable)
      .mockResolvedValueOnce(profileRowFound)
      .mockResolvedValueOnce(invitationRowActionable);

    await service.completeActivation(invitation(), tenant(), profile());

    expect(mocks.tenantsUpdate).toHaveBeenCalledTimes(1);
    expect(mocks.tenantsUpdate.mock.calls[0][0].data.status).toBe("ACTIVE");

    expect(mocks.visitorLeadUpdateMany).toHaveBeenCalledTimes(1);
    const [args] = mocks.visitorLeadUpdateMany.mock.calls[0];
    expect(args.where).toEqual({ converted_tenant_id: TENANT_ID });
    expect(args.data.status).toBe("JOINED");
    expect(args.data.updated_at).toBeInstanceOf(Date);

    // Both writes happened inside the one $transaction callback, sharing the
    // same fake `tx` — not a separate post-commit call against a different
    // client.
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
  });

  it("skips everything, including marking JOINED, when the tenant is already active", async () => {
    mocks.queryRaw.mockResolvedValueOnce([{ id: TENANT_ID, status: "ACTIVE", joined_on: null, owner_id: "owner-1" }]);

    await service.completeActivation(invitation(), tenant(), profile());

    expect(mocks.tenantsUpdate).not.toHaveBeenCalled();
    expect(mocks.visitorLeadUpdateMany).not.toHaveBeenCalled();
    // Only the one tenant-row lock ran before the idempotency guard returned.
    expect(mocks.queryRaw).toHaveBeenCalledTimes(1);
  });

  it("skips everything, including marking JOINED, when the invitation is already activated", async () => {
    mocks.queryRaw
      .mockResolvedValueOnce(tenantRowActionable)
      .mockResolvedValueOnce(profileRowFound)
      .mockResolvedValueOnce([{ id: INVITATION_ID, status: "ACTIVATED" }]);

    await service.completeActivation(invitation(), tenant(), profile());

    expect(mocks.tenantsUpdate).not.toHaveBeenCalled();
    expect(mocks.visitorLeadUpdateMany).not.toHaveBeenCalled();
  });
});

describe("TenantInvitationLifecycleService.createInvitation — owner cannot invite themselves", () => {
  let lifecycleService: TenantInvitationLifecycleService;

  const ownerRoom = () => ({
    id: "room-1",
    is_active: true,
    hostels: { id: "hostel-1", owner_id: "owner-1", status: "ACTIVE" },
  });

  beforeEach(() => {
    vi.clearAllMocks();
    lifecycleService = new TenantInvitationLifecycleService();
    mocks.roomsFindFirst.mockResolvedValue(ownerRoom());
    mocks.profileFindUnique.mockResolvedValue({
      id: "owner-1",
      role: "OWNER",
      phone: "+919876543210",
      email: "owner@example.com",
    });
    mocks.tenantInvitationsFindFirst.mockResolvedValue(null);
  });

  it("rejects when the invited phone matches the owner's own registered phone", async () => {
    await expect(
      lifecycleService.createInvitation(
        { name: "Rahul", phone: "9876543210", room_id: "room-1" },
        "owner-1",
      ),
    ).rejects.toThrow(/cannot invite yourself/i);
    expect(mocks.tenantInvitationsFindFirst).not.toHaveBeenCalled();
  });

  it("rejects when the invited email matches the owner's own email, even with a different phone", async () => {
    await expect(
      lifecycleService.createInvitation(
        { name: "Rahul", phone: "9000000000", email: "Owner@Example.com", room_id: "room-1" },
        "owner-1",
      ),
    ).rejects.toThrow(/cannot invite yourself/i);
  });

  it("does not flag an invitation whose phone and email are unrelated to the owner's own identity", async () => {
    const error: any = await lifecycleService
      .createInvitation(
        { name: "Rahul", phone: "9000000000", email: "rahul@example.com", room_id: "room-1" },
        "owner-1",
      )
      .catch((e: any) => e);

    // Falls through to later validation (unmocked eligibility/billing internals
    // in this focused suite) — the point of this test is only that it is NOT
    // refused as a self-invite.
    expect(String(error?.message || "")).not.toMatch(/cannot invite yourself/i);
  });
});
