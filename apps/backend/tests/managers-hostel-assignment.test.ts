import { describe, expect, it, vi, beforeEach } from "vitest";

const txMock = {
  manager_hostel_assignments: { findFirst: vi.fn(), update: vi.fn(), create: vi.fn() },
};

vi.mock("@/lib/db", () => ({
  prisma: {
    manager_profiles: { findUnique: vi.fn() },
    hostels: { findMany: vi.fn() },
    manager_hostel_assignments: { findMany: vi.fn(), createMany: vi.fn(), update: vi.fn() },
    $transaction: vi.fn(async (arg: any) => (typeof arg === "function" ? arg(txMock) : Promise.all(arg))),
  },
  supabase: {},
}));

import { prisma } from "@/lib/db";
import { managerService } from "@/src/services/managers/manager-service";

const db = () => prisma as any;

const MANAGER_ID = "manager-1";
const OTHER_MANAGER_ID = "manager-2";
const HOSTEL_A = "11111111-1111-1111-1111-111111111111";
const ADMIN_ID = "admin-1";

function mockGetManager(id = MANAGER_ID) {
  db().manager_profiles.findUnique.mockResolvedValue({
    id,
    profile_id: `profile-${id}`,
    profile: { id: `profile-${id}`, name: "Rahul Kumar", email: "rahul@example.com", phone: "9999999999", is_active: true },
    permissions: [],
    hostel_assignments: [],
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("assignHostels", () => {
  it("rejects assigning a hostel that already has an active manager", async () => {
    mockGetManager();
    db().hostels.findMany.mockResolvedValue([{ id: HOSTEL_A }]);
    db().manager_hostel_assignments.findMany.mockResolvedValue([{ hostel_id: HOSTEL_A }]);

    await expect(managerService.assignHostels(MANAGER_ID, [HOSTEL_A], ADMIN_ID)).rejects.toThrow(
      /already assigned/,
    );
    expect(db().manager_hostel_assignments.createMany).not.toHaveBeenCalled();
  });

  it("assigns a hostel with no active manager", async () => {
    mockGetManager();
    db().hostels.findMany.mockResolvedValue([{ id: HOSTEL_A }]);
    db().manager_hostel_assignments.findMany.mockResolvedValue([]);
    db().manager_hostel_assignments.createMany.mockResolvedValue({ count: 1 });

    await managerService.assignHostels(MANAGER_ID, [HOSTEL_A], ADMIN_ID);
    expect(db().manager_hostel_assignments.createMany).toHaveBeenCalledWith({
      data: [{ manager_profile_id: MANAGER_ID, hostel_id: HOSTEL_A, assigned_by: ADMIN_ID }],
    });
  });
});

describe("unassignHostel", () => {
  it("closes the row (sets unassigned_at) instead of deleting it", async () => {
    mockGetManager();
    db().manager_hostel_assignments.findFirst = vi.fn().mockResolvedValue({ id: "assignment-1" });
    db().manager_hostel_assignments.update.mockResolvedValue({});

    await managerService.unassignHostel(MANAGER_ID, HOSTEL_A, ADMIN_ID);
    expect(db().manager_hostel_assignments.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "assignment-1" },
        data: expect.objectContaining({ unassigned_by: ADMIN_ID }),
      }),
    );
  });

  it("rejects unassigning a hostel that is not currently assigned to this manager", async () => {
    db().manager_hostel_assignments.findFirst = vi.fn().mockResolvedValue(null);
    await expect(managerService.unassignHostel(MANAGER_ID, HOSTEL_A, ADMIN_ID)).rejects.toThrow(/not assigned/);
  });
});

describe("reassignHostel — history must survive", () => {
  it("closes the old manager's row and opens a new one for the target manager, atomically", async () => {
    mockGetManager(OTHER_MANAGER_ID);
    txMock.manager_hostel_assignments.findFirst.mockResolvedValue({
      id: "old-assignment",
      manager_profile_id: MANAGER_ID,
    });
    txMock.manager_hostel_assignments.update.mockResolvedValue({});
    txMock.manager_hostel_assignments.create.mockResolvedValue({ id: "new-assignment" });

    const result = await managerService.reassignHostel(HOSTEL_A, OTHER_MANAGER_ID, ADMIN_ID);

    // The old row is updated (unassigned_at set), never deleted.
    expect(txMock.manager_hostel_assignments.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "old-assignment" },
        data: expect.objectContaining({ unassigned_by: ADMIN_ID }),
      }),
    );
    expect(txMock.manager_hostel_assignments.create).toHaveBeenCalledWith({
      data: { manager_profile_id: OTHER_MANAGER_ID, hostel_id: HOSTEL_A, assigned_by: ADMIN_ID },
    });
    expect(result.previousManagerProfileId).toBe(MANAGER_ID);
  });

  it("is a no-op error, not a silent success, when reassigning to the same manager who already has it", async () => {
    mockGetManager(MANAGER_ID);
    txMock.manager_hostel_assignments.findFirst.mockResolvedValue({
      id: "old-assignment",
      manager_profile_id: MANAGER_ID,
    });

    await expect(managerService.reassignHostel(HOSTEL_A, MANAGER_ID, ADMIN_ID)).rejects.toThrow(
      /already assigned to this manager/,
    );
    expect(txMock.manager_hostel_assignments.update).not.toHaveBeenCalled();
  });

  it("handles a hostel with no current manager (first assignment via reassign)", async () => {
    mockGetManager(MANAGER_ID);
    txMock.manager_hostel_assignments.findFirst.mockResolvedValue(null);
    txMock.manager_hostel_assignments.create.mockResolvedValue({ id: "new-assignment" });

    const result = await managerService.reassignHostel(HOSTEL_A, MANAGER_ID, ADMIN_ID);
    expect(txMock.manager_hostel_assignments.update).not.toHaveBeenCalled();
    expect(result.previousManagerProfileId).toBeNull();
  });
});
