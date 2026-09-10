import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { roomCapacityService } from "@/lib/services/room-capacity-service";
import { onboardingFinancialsService } from "@/src/services/payments/onboarding-financials-service";
import { tenantInvitationLifecycleService } from "@/src/services/tenants/tenant-invitation-lifecycle-service";
import { invitationService } from "@/src/services/tenants/invitation-service";
import { AdmissionsService } from "@/src/services/admissions/admissions-service";

vi.mock("@/lib/db", () => {
  const tx = {
    $executeRaw: vi.fn(),
    tenants: { create: vi.fn(), update: vi.fn() },
    tenant_invitations: { create: vi.fn(), update: vi.fn() },
    tenant_invitation_reservations: { create: vi.fn(), update: vi.fn() },
    rooms: { findFirst: vi.fn(), findUnique: vi.fn() },
    // createInvitation stands the tenancy up live-but-unaccepted inside the
    // same transaction (see initializeActiveUnacceptedTenancy) — these back
    // that: linking/creating the profile and converting the reservation to a
    // real allocation.
    profile: { findUnique: vi.fn(), create: vi.fn() },
    roomAllocation: { findFirst: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
    rent_obligations: { findMany: vi.fn(async () => []), updateMany: vi.fn() },
    tenant_owner_attestations: { create: vi.fn() },
  };
  const mockPrisma = {
    profile: { findUnique: vi.fn() },
    tenants: { findFirst: vi.fn() },
    tenant_invitations: { findFirst: vi.fn() },
    rooms: { findFirst: vi.fn(), findUnique: vi.fn() },
    visitorLead: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    roomReservation: {
      updateMany: vi.fn(),
    },
    $transaction: vi.fn(async (fn: any) => fn(tx)),
    __tx: tx,
  };
  return { prisma: mockPrisma, supabase: {} };
});

vi.mock("@/lib/services/hostel-billing-preferences-service", () => ({
  hostelBillingPreferencesService: {
    resolveTenantInviteDefaults: vi.fn(async () => ({
      resolved_values: {
        monthly_rent: 8000,
        advance_deposit: 10000,
        maintenance_charge: 1500,
        maintenance_type: "MONTHLY",
      },
      billing_defaults: {},
    })),
  },
}));

vi.mock("@/lib/services/room-capacity-service", () => ({
  roomCapacityService: {
    getRoomCapacitySnapshot: vi.fn(),
  },
}));

vi.mock("@/src/services/payments/onboarding-financials-service", () => ({
  onboardingFinancialsService: {
    initializeOnboardingFinancials: vi.fn(async () => ({
      createdObligations: ["MAINTENANCE"],
      createdObligationIds: [],
      skipped: false,
    })),
  },
}));

vi.mock("@/lib/services/event-log-service", () => ({
  eventLog: { log: vi.fn() },
}));

vi.mock("@/lib/services/email-service", () => ({
  EmailService: {
    sendInvitation: vi.fn(async () => ({ sent: true })),
  },
}));

vi.mock("@/lib/services/notifications/providers/whatsapp/meta-provider", () => ({
  MetaWhatsAppProvider: class {
    async sendInvitation() {
      return { providerMessageId: "wamid.test" };
    }
  },
}));

vi.mock("@/lib/redis/cache", () => ({
  getOrSetJson: vi.fn(),
  invalidateTag: vi.fn(),
}));

vi.mock("@/lib/redis/rate-limit", () => ({
  checkFixedWindowLimit: vi.fn(),
}));

describe("onboarding financial flow routing", () => {
  const tx = (prisma as any).__tx;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.profile.findUnique).mockResolvedValue({
      id: "owner-1",
      role: "OWNER",
      name: "Owner",
    } as any);
    vi.mocked(prisma.tenants.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.tenant_invitations.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.visitorLead.findFirst).mockResolvedValue({
      id: "lead-1",
      student_name: "Admissions Tenant",
      student_phone: "9876543212",
      student_email: "admissions@example.com",
      converted_tenant_id: null,
    } as any);
    vi.mocked(prisma.visitorLead.update).mockResolvedValue({
      id: "lead-1",
      status: "INVITED",
      student_name: "Admissions Tenant",
      student_phone: "9876543212",
      student_email: "admissions@example.com",
    } as any);
    vi.mocked(prisma.roomReservation.updateMany).mockResolvedValue({ count: 1 } as any);
    vi.mocked(roomCapacityService.getRoomCapacitySnapshot).mockResolvedValue({
      available: 2,
      occupied: 0,
      room: {
        id: "room-1",
        hostel_id: "hostel-1",
        room_no: "101",
        capacity: 2,
        hostels: {
          id: "hostel-1",
          owner_id: "owner-1",
          name: "Sri Hostel",
          rent_cycle: "MONTHLY",
        },
      },
    } as any);
    vi.mocked(prisma.rooms.findFirst).mockResolvedValue({
      id: "room-1",
      hostel_id: "hostel-1",
      room_no: "101",
      capacity: 2,
      base_rent: 8000,
      hostels: {
        id: "hostel-1",
        owner_id: "owner-1",
        name: "Sri Hostel",
        rent_cycle: "MONTHLY",
      },
    } as any);
    tx.rooms.findFirst.mockResolvedValue({
      id: "room-1",
      hostel_id: "hostel-1",
      room_no: "101",
      capacity: 2,
      base_rent: 8000,
      hostels: {
        id: "hostel-1",
        owner_id: "owner-1",
        name: "Sri Hostel",
        rent_cycle: "MONTHLY",
      },
    });
    tx.tenants.create.mockResolvedValue({
      id: "tenant-1",
      owner_id: "owner-1",
      hostel_id: "hostel-1",
      monthly_rent: 8000,
      advance_deposit: 10000,
      maintenance_charge: 1500,
      maintenance_type: "MONTHLY",
      phone_1: "+919876543210",
    });
    tx.tenant_invitations.create.mockImplementation(async ({ data }: any) => ({
      id: "invitation-1",
      ...data,
    }));
    tx.tenant_invitation_reservations.create.mockImplementation(async ({ data }: any) => ({
      id: "reservation-1",
      ...data,
    }));
    // initializeActiveUnacceptedTenancy's writes — see the tx mock's comment above.
    tx.tenants.update.mockResolvedValue({});
    tx.tenant_invitations.update.mockResolvedValue({});
    tx.tenant_invitation_reservations.update.mockResolvedValue({});
    tx.profile.findUnique.mockResolvedValue(null);
    tx.profile.create.mockResolvedValue({ id: "profile-1" });
    tx.roomAllocation.findFirst.mockResolvedValue(null);
    tx.roomAllocation.create.mockResolvedValue({ id: "allocation-1" });
    tx.rent_obligations.findMany.mockResolvedValue([]);
  });

  it("manual invite reaches the shared onboarding financial initializer", async () => {
    const result = await invitationService.inviteTenant({
      name: "Manual Tenant",
      phone: "9876543210",
      room_id: "room-1",
      monthly_rent: 8000,
      maintenance_type: "MONTHLY",
      maintenance_amount: 1500,
    }, "owner-1");

    expect((result as any).obligations).toEqual(["MAINTENANCE"]);
    expect(onboardingFinancialsService.initializeOnboardingFinancials).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        tenantId: "tenant-1",
        ownerId: "owner-1",
        hostelId: "hostel-1",
        maintenanceCharge: 1500,
        maintenanceType: "MONTHLY",
      })
    );
  });

  it("bulk invitation import reaches the same initializer through createInvitation", async () => {
    await tenantInvitationLifecycleService.createInvitation({
      name: "Bulk Tenant",
      phone: "9876543211",
      room_id: "room-1",
      monthly_rent: 8000,
      maintenance_type: "ONE_TIME",
      maintenance_amount: 1500,
      batch_id: "batch-1",
    }, "owner-1");

    expect(onboardingFinancialsService.initializeOnboardingFinancials).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        tenantId: "tenant-1",
        maintenanceCharge: 1500,
        maintenanceType: "ONE_TIME",
      })
    );
  });

  it("admissions conversion reaches the same initializer through InvitationService", async () => {
    const service = new AdmissionsService();

    await service.convertToInvitation("lead-1", "owner-1", {
      room_id: "room-1",
      monthly_rent: 8000,
      advance_amount: 10000,
      maintenance_type: "MONTHLY",
      maintenance_amount: 1500,
      joining_date: "2026-07-10",
    });

    expect(onboardingFinancialsService.initializeOnboardingFinancials).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        tenantId: "tenant-1",
        ownerId: "owner-1",
        hostelId: "hostel-1",
        maintenanceCharge: 1500,
        maintenanceType: "MONTHLY",
      })
    );
  });
});
