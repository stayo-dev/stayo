/**
 * Super-Admin-only CRUD for MANAGER accounts, permissions and hostel
 * assignments. Every export here is called exclusively from ADMIN-gated
 * routes (`app/api/platform-admin/managers/**`) — there is no
 * manager-reachable path to any of these functions, which is what makes
 * self-escalation / self-role-change / self-suspend structurally
 * impossible rather than merely checked for.
 */
import crypto from "crypto";
import { prisma } from "@/lib/db";
import type { ManagerPermission } from "@prisma/client";

export class ManagerServiceError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "ManagerServiceError";
  }
}

export interface CreateManagerInput {
  name: string;
  phone: string;
  email: string;
  permissions: ManagerPermission[];
  invitedBy: string;
}

function managerInclude() {
  return {
    profile: { select: { id: true, name: true, email: true, phone: true, is_active: true } },
    permissions: { select: { permission: true } },
    hostel_assignments: {
      where: { unassigned_at: null },
      select: { id: true, hostel_id: true, assigned_at: true },
    },
  } as const;
}

export class ManagerService {
  async createManager(input: CreateManagerInput) {
    const email = input.email.trim().toLowerCase();
    const phone = input.phone.trim();
    const name = input.name.trim();
    if (!name || !phone || !email) {
      throw new ManagerServiceError("name, phone and email are required", "INVALID_INPUT", 422);
    }

    const existing = await prisma.profile.findFirst({ where: { OR: [{ email }, { phone }] } });
    if (existing) {
      throw new ManagerServiceError("An account with this email or phone already exists", "ALREADY_EXISTS", 409);
    }

    const created = await prisma.$transaction(async (tx: any) => {
      const profile = await tx.profile.create({
        data: {
          id: crypto.randomUUID(),
          name,
          phone,
          email,
          role: "MANAGER",
          is_active: true,
          is_profile_completed: false,
        },
      });
      const manager = await tx.manager_profiles.create({
        data: {
          profile_id: profile.id,
          status: "PENDING_INVITATION",
          invited_by: input.invitedBy,
        },
      });
      if (input.permissions.length > 0) {
        await tx.manager_permission_grants.createMany({
          data: input.permissions.map((permission) => ({
            manager_profile_id: manager.id,
            permission,
            granted_by: input.invitedBy,
          })),
        });
      }
      return manager.id;
    });

    return prisma.manager_profiles.findUnique({ where: { id: created }, include: managerInclude() });
  }

  async listManagers(filters: { search?: string; status?: string } = {}) {
    const where: any = {};
    if (filters.status) where.status = filters.status;
    if (filters.search) {
      where.profile = {
        OR: [
          { name: { contains: filters.search, mode: "insensitive" } },
          { email: { contains: filters.search, mode: "insensitive" } },
          { phone: { contains: filters.search, mode: "insensitive" } },
        ],
      };
    }
    return prisma.manager_profiles.findMany({
      where,
      include: managerInclude(),
      orderBy: { created_at: "desc" },
    });
  }

  async getManager(id: string) {
    const manager = await prisma.manager_profiles.findUnique({ where: { id }, include: managerInclude() });
    if (!manager) throw new ManagerServiceError("Manager not found", "NOT_FOUND", 404);
    return manager;
  }

  async updateManager(id: string, data: { name?: string; phone?: string }) {
    const manager = await this.getManager(id);
    const profileData: any = {};
    if (data.name?.trim()) profileData.name = data.name.trim();
    if (data.phone?.trim()) profileData.phone = data.phone.trim();
    if (Object.keys(profileData).length > 0) {
      await prisma.profile.update({ where: { id: manager.profile_id }, data: profileData });
    }
    return this.getManager(id);
  }

  /** Full replace, not incremental — the drawer's permission editor submits the whole set. */
  async setPermissions(id: string, permissions: ManagerPermission[], grantedBy: string) {
    await this.getManager(id);
    await prisma.$transaction([
      prisma.manager_permission_grants.deleteMany({ where: { manager_profile_id: id } }),
      ...(permissions.length > 0
        ? [
            prisma.manager_permission_grants.createMany({
              data: permissions.map((permission) => ({ manager_profile_id: id, permission, granted_by: grantedBy })),
            }),
          ]
        : []),
    ]);
    return this.getManager(id);
  }

  async suspendManager(id: string, suspendedBy: string, reason?: string) {
    const manager = await this.getManager(id);
    await prisma.$transaction([
      prisma.manager_profiles.update({
        where: { id },
        data: { status: "SUSPENDED", suspended_at: new Date(), suspended_by: suspendedBy, suspended_reason: reason },
      }),
      // Reuses the same is_active gate every other role's login already goes
      // through (lib/auth/supabase-session.ts) — no new enforcement point.
      prisma.profile.update({ where: { id: manager.profile_id }, data: { is_active: false } }),
    ]);
    return this.getManager(id);
  }

  async reactivateManager(id: string) {
    const manager = await this.getManager(id);
    await prisma.$transaction([
      prisma.manager_profiles.update({
        where: { id },
        data: { status: "ACTIVE", suspended_at: null, suspended_by: null, suspended_reason: null },
      }),
      prisma.profile.update({ where: { id: manager.profile_id }, data: { is_active: true } }),
    ]);
    return this.getManager(id);
  }

  // ── Hostel assignment ────────────────────────────────────────────────

  async assignHostels(id: string, hostelIds: string[], assignedBy: string) {
    await this.getManager(id);
    const uniqueIds = Array.from(new Set(hostelIds));
    const hostels = await prisma.hostels.findMany({ where: { id: { in: uniqueIds } }, select: { id: true } });
    if (hostels.length !== uniqueIds.length) {
      throw new ManagerServiceError("One or more hostels do not exist", "INVALID_HOSTEL", 422);
    }
    const alreadyActive = await prisma.manager_hostel_assignments.findMany({
      where: { hostel_id: { in: uniqueIds }, unassigned_at: null },
    });
    if (alreadyActive.length > 0) {
      throw new ManagerServiceError(
        "One or more hostels are already assigned to a manager — use reassign instead",
        "ALREADY_ASSIGNED",
        409,
      );
    }
    await prisma.manager_hostel_assignments.createMany({
      data: uniqueIds.map((hostel_id) => ({ manager_profile_id: id, hostel_id, assigned_by: assignedBy })),
    });
    return this.getManager(id);
  }

  async unassignHostel(id: string, hostelId: string, unassignedBy: string) {
    const active = await prisma.manager_hostel_assignments.findFirst({
      where: { manager_profile_id: id, hostel_id: hostelId, unassigned_at: null },
    });
    if (!active) throw new ManagerServiceError("Hostel is not assigned to this manager", "NOT_ASSIGNED", 404);
    await prisma.manager_hostel_assignments.update({
      where: { id: active.id },
      data: { unassigned_at: new Date(), unassigned_by: unassignedBy },
    });
    return this.getManager(id);
  }

  /**
   * Closes the current active assignment (if any) and opens a new one for
   * `toManagerId`, atomically. The old row is never deleted — its
   * `unassigned_at` is set — so historical activity stays attributable.
   */
  async reassignHostel(hostelId: string, toManagerId: string, actedBy: string) {
    await this.getManager(toManagerId);
    return prisma.$transaction(async (tx: any) => {
      const current = await tx.manager_hostel_assignments.findFirst({
        where: { hostel_id: hostelId, unassigned_at: null },
      });
      if (current) {
        if (current.manager_profile_id === toManagerId) {
          throw new ManagerServiceError("Hostel is already assigned to this manager", "NO_OP", 409);
        }
        await tx.manager_hostel_assignments.update({
          where: { id: current.id },
          data: { unassigned_at: new Date(), unassigned_by: actedBy },
        });
      }
      const created = await tx.manager_hostel_assignments.create({
        data: { manager_profile_id: toManagerId, hostel_id: hostelId, assigned_by: actedBy },
      });
      return { previousManagerProfileId: current?.manager_profile_id ?? null, assignment: created };
    });
  }
}

export const managerService = new ManagerService();
