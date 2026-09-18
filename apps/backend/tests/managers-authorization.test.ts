import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    manager_profiles: { findUnique: vi.fn() },
  },
  supabase: {},
}));

import { prisma } from "@/lib/db";
import {
  requireAdminOrManagerPermission,
  assertHostelAccess,
  scopeHostelIds,
} from "@/src/services/managers/manager-authorization";

const db = () => prisma as any;

const MANAGER_SESSION = { sub: "manager-profile-1", role: "MANAGER" };
const ADMIN_SESSION = { sub: "admin-1", role: "ADMIN" };
const OWNER_SESSION = { sub: "owner-1", role: "OWNER" };

const HOSTEL_A = "11111111-1111-1111-1111-111111111111";
const HOSTEL_B = "22222222-2222-2222-2222-222222222222";

function mockManager(overrides: Partial<{ permissions: string[]; hostelIds: string[] }> = {}) {
  db().manager_profiles.findUnique.mockResolvedValue({
    id: "manager-record-1",
    profile_id: MANAGER_SESSION.sub,
    permissions: (overrides.permissions ?? []).map((permission) => ({ permission })),
    hostel_assignments: (overrides.hostelIds ?? []).map((hostel_id) => ({ hostel_id })),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("requireAdminOrManagerPermission", () => {
  it("lets ADMIN through without ever loading a manager scope", async () => {
    await expect(requireAdminOrManagerPermission(ADMIN_SESSION, "MANAGE_HOSTELS")).resolves.toBeUndefined();
    expect(db().manager_profiles.findUnique).not.toHaveBeenCalled();
  });

  it("lets a MANAGER through when they hold the exact grant", async () => {
    mockManager({ permissions: ["MANAGE_HOSTELS"] });
    await expect(requireAdminOrManagerPermission(MANAGER_SESSION, "MANAGE_HOSTELS")).resolves.toBeUndefined();
  });

  it("rejects a MANAGER missing the grant", async () => {
    mockManager({ permissions: ["MANAGE_OWNERS"] });
    await expect(requireAdminOrManagerPermission(MANAGER_SESSION, "MANAGE_HOSTELS")).rejects.toThrow(
      /Missing manager permission/,
    );
  });

  it("rejects any other role, including OWNER", async () => {
    await expect(requireAdminOrManagerPermission(OWNER_SESSION, "MANAGE_HOSTELS")).rejects.toThrow(
      /Admin access only/,
    );
  });

  it("rejects a null session", async () => {
    await expect(requireAdminOrManagerPermission(null, "MANAGE_HOSTELS")).rejects.toThrow(
      /Authentication required/,
    );
  });
});

describe("assertHostelAccess — a manager can only touch hostels assigned to them", () => {
  it("lets ADMIN through for any hostel", async () => {
    await expect(assertHostelAccess(ADMIN_SESSION, HOSTEL_A)).resolves.toBeUndefined();
  });

  it("lets a MANAGER through for a hostel they are actively assigned", async () => {
    mockManager({ hostelIds: [HOSTEL_A, HOSTEL_B] });
    await expect(assertHostelAccess(MANAGER_SESSION, HOSTEL_A)).resolves.toBeUndefined();
  });

  it("rejects a MANAGER for a hostel that is not theirs — even with a perfectly valid session", async () => {
    mockManager({ hostelIds: [HOSTEL_B] });
    await expect(assertHostelAccess(MANAGER_SESSION, HOSTEL_A)).rejects.toThrow(/Not assigned to this hostel/);
  });

  it("rejects a MANAGER for a hostel that was reassigned away (no longer in the active list)", async () => {
    // loadManagerScope only ever includes rows where unassigned_at is null,
    // so a reassigned-away hostel simply never appears here.
    mockManager({ hostelIds: [] });
    await expect(assertHostelAccess(MANAGER_SESSION, HOSTEL_A)).rejects.toThrow(/Not assigned to this hostel/);
  });

  it("requires an explicit hostelId — never an optional/undefined one", async () => {
    await expect(assertHostelAccess(ADMIN_SESSION, "" as any)).rejects.toThrow(/hostelId is required/);
  });
});

describe("scopeHostelIds", () => {
  it("returns null (unrestricted) for ADMIN", async () => {
    await expect(scopeHostelIds(ADMIN_SESSION)).resolves.toBeNull();
  });

  it("returns exactly the manager's active assignment list — usable directly as a Prisma id-in filter", async () => {
    mockManager({ hostelIds: [HOSTEL_A] });
    await expect(scopeHostelIds(MANAGER_SESSION)).resolves.toEqual([HOSTEL_A]);
  });

  it("returns an empty array, not null, for a manager with zero assignments — must never be read as unrestricted", async () => {
    mockManager({ hostelIds: [] });
    await expect(scopeHostelIds(MANAGER_SESSION)).resolves.toEqual([]);
  });
});
