/**
 * ════════════════════════════════════════════════════════════
 * Change Request Service — Core Lifecycle Management
 * ════════════════════════════════════════════════════════════
 *
 * Central service for creating, listing, and managing change
 * requests. This is the backbone of the Change Management System.
 *
 * Lifecycle:
 *   PENDING → APPROVED → APPLIED
 *   PENDING → REJECTED
 *   PENDING → EXPIRED
 *   PENDING → CANCELLED
 */

import { prisma } from "../../../lib/db";
import { getLogger } from "../../../lib/logger";
import type { ChangeCategory, ChangeApprovalLevel, ChangeRequestStatus } from "@prisma/client";
import {
  partitionFieldsByCategory,
  classifyTenantField,
  isInCorrectionWindow,
  EXPIRATION_DAYS,
  CATEGORY_LABELS,
} from "./field-classification";
import { createTenantSnapshot, computeDiff, summarizeDiff } from "./diff-engine";

const logger = getLogger("change-request-service");

// ─── Types ───────────────────────────────────────────────────

export interface CreateChangeRequestInput {
  ownerId: string;
  hostelId: string;
  tenantId: string;
  entityType: string;
  entityId: string;
  changeCategory: ChangeCategory;
  changeType: string;
  approvalLevel: ChangeApprovalLevel;
  before: Record<string, unknown>;
  diff: Record<string, unknown>;
  reason: string;
  effectiveDate?: Date;
  requestedBy: string;
  metadata?: Record<string, unknown>;
}

export interface ChangeRequestResult {
  id: string;
  status: ChangeRequestStatus;
  changeCategory: ChangeCategory;
  approvalLevel: ChangeApprovalLevel;
  message: string;
}

// ─── Service ─────────────────────────────────────────────────

class ChangeRequestService {

  /**
   * Create a new change request.
   */
  async createChangeRequest(input: CreateChangeRequestInput): Promise<ChangeRequestResult> {
    const {
      ownerId, hostelId, tenantId, entityType, entityId,
      changeCategory, changeType, approvalLevel,
      before, diff, reason,
      effectiveDate, requestedBy, metadata,
    } = input;

    // Compute expiration
    const expirationDays = EXPIRATION_DAYS[approvalLevel];
    const expiresAt = expirationDays
      ? new Date(Date.now() + expirationDays * 24 * 60 * 60 * 1000)
      : null;

    const cr = await prisma.change_requests.create({
      data: {
        owner_id: ownerId,
        hostel_id: hostelId,
        tenant_id: tenantId,
        entity_type: entityType,
        entity_id: entityId,
        change_category: changeCategory,
        change_type: changeType,
        approval_level: approvalLevel,
        status: "PENDING",
        requested_by: requestedBy,
        before: before as any,
        diff: diff as any,
        reason,
        effective_date: effectiveDate ?? null,
        expires_at: expiresAt,
        metadata: metadata as any ?? null,
      },
    });

    // Record creation event
    await this.recordEvent(cr.id, "created", requestedBy, "owner", {
      proposed_changes: diff,
    });

    logger.info("change_request_created", {
      cr_id: cr.id,
      tenant_id: tenantId,
      category: changeCategory,
      level: approvalLevel,
      type: changeType,
    });

    return {
      id: cr.id,
      status: cr.status as ChangeRequestStatus,
      changeCategory: cr.change_category as ChangeCategory,
      approvalLevel: cr.approval_level as ChangeApprovalLevel,
      message: `Change request created. Awaiting tenant approval.`,
    };
  }

  /**
   * Apply Category A fields immediately (owner-controlled).
   * Creates audit record without requiring a full change request.
   */
  async applyImmediateChange(input: {
    ownerId: string;
    hostelId: string;
    tenantId: string;
    entityType: string;
    entityId: string;
    before: Record<string, unknown>;
    diff: Record<string, unknown>;
    reason: string;
    requestedBy: string;
    metadata?: Record<string, unknown>;
  }): Promise<ChangeRequestResult> {
    // Create a CR in APPLIED status directly (for audit trail)
    const now = new Date();

    const cr = await prisma.change_requests.create({
      data: {
        owner_id: input.ownerId,
        hostel_id: input.hostelId,
        tenant_id: input.tenantId,
        entity_type: input.entityType,
        entity_id: input.entityId,
        change_category: "A",
        change_type: "profile_update",
        approval_level: "L1",
        status: "APPLIED",
        requested_by: input.requestedBy,
        approved_by: input.requestedBy,
        approved_at: now,
        applied_at: now,
        before: input.before as any,
        diff: input.diff as any,
        reason: input.reason,
        metadata: input.metadata as any ?? null,
      },
    });

    await this.recordEvent(cr.id, "applied", input.requestedBy, "owner", {
      applied_changes: input.diff,
    });

    logger.info("immediate_change_applied", {
      cr_id: cr.id,
      tenant_id: input.tenantId,
      fields: Object.keys(input.diff),
    });

    return {
      id: cr.id,
      status: "APPLIED",
      changeCategory: "A",
      approvalLevel: "L1",
      message: "Changes applied immediately.",
    };
  }

  /**
   * List change requests for a tenant, owner, or hostel.
   */
  async listChangeRequests(filters: {
    tenantId?: string;
    ownerId?: string;
    hostelId?: string;
    status?: ChangeRequestStatus | ChangeRequestStatus[];
    limit?: number;
    offset?: number;
  }) {
    const where: any = {};
    if (filters.tenantId) where.tenant_id = filters.tenantId;
    if (filters.ownerId) where.owner_id = filters.ownerId;
    if (filters.hostelId) where.hostel_id = filters.hostelId;
    if (filters.status) {
      where.status = Array.isArray(filters.status)
        ? { in: filters.status }
        : filters.status;
    }

    const limit = filters.limit ?? 25;
    const offset = filters.offset ?? 0;

    const [requests, total] = await Promise.all([
      prisma.change_requests.findMany({
        where,
        orderBy: { created_at: "desc" },
        take: limit,
        skip: offset,
        include: {
          events: {
            orderBy: { created_at: "desc" },
            take: 5,
          },
        },
      }),
      prisma.change_requests.count({ where }),
    ]);

    return { requests, total, limit, offset };
  }

  /**
   * Get a single change request by ID with full event timeline.
   */
  async getChangeRequest(id: string, actorId: string) {
    const cr = await prisma.change_requests.findUnique({
      where: { id },
      include: {
        events: { orderBy: { created_at: "asc" } },
        tenant: {
          include: { profiles: { select: { name: true, email: true } } },
        },
      },
    });

    if (!cr) throw new Error("NOT_FOUND: Change request not found");

    // Compute diff for display
    const before = cr.before as Record<string, unknown>;
    const diff = cr.diff as Record<string, unknown>;
    const diffResult = computeDiff(before, diff);

    return {
      ...cr,
      diff: diffResult.diffs,
      summary: summarizeDiff(diffResult.diffs),
      categoryLabel: CATEGORY_LABELS[cr.change_category as ChangeCategory],
    };
  }

  /**
   * Cancel a pending change request (by owner).
   */
  async cancelChangeRequest(id: string, actorId: string, reason?: string) {
    const cr = await prisma.change_requests.findUnique({ where: { id } });
    if (!cr) throw new Error("NOT_FOUND: Change request not found");
    if (cr.status !== "PENDING") {
      throw new Error(`VALIDATION: Cannot cancel a ${cr.status} request`);
    }
    if (cr.requested_by !== actorId && cr.owner_id !== actorId) {
      throw new Error("FORBIDDEN: Only the requester or owner can cancel");
    }

    const updated = await prisma.change_requests.update({
      where: { id },
      data: {
        status: "CANCELLED",
        cancelled_at: new Date(),
        updated_at: new Date(),
      },
    });

    await this.recordEvent(id, "cancelled", actorId, "owner", null, reason);

    logger.info("change_request_cancelled", { cr_id: id, actor_id: actorId });

    return updated;
  }

  /**
   * Get the change history for a specific entity.
   * Returns all applied change requests, ordered chronologically.
   */
  async getEntityChangeHistory(entityType: string, entityId: string, limit = 50) {
    return prisma.change_requests.findMany({
      where: {
        entity_type: entityType,
        entity_id: entityId,
        status: "APPLIED",
      },
      orderBy: { applied_at: "desc" },
      take: limit,
      include: {
        events: { orderBy: { created_at: "asc" } },
      },
    });
  }

  /**
   * Get pending change requests for a tenant (for tenant portal).
   */
  async getPendingForTenant(tenantId: string) {
    return prisma.change_requests.findMany({
      where: {
        tenant_id: tenantId,
        status: "PENDING",
        approval_level: { in: ["L2", "L3"] },
      },
      orderBy: { created_at: "desc" },
    });
  }

  /**
   * Count pending change requests for a tenant (for badge display).
   */
  async countPendingForTenant(tenantId: string): Promise<number> {
    return prisma.change_requests.count({
      where: {
        tenant_id: tenantId,
        status: "PENDING",
        approval_level: { in: ["L2", "L3"] },
      },
    });
  }

  // ─── Internal Helpers ────────────────────────────────────

  /**
   * Record an immutable audit event for a change request.
   */
  private async recordEvent(
    changeRequestId: string,
    action: string,
    actorId: string | null,
    actorRole: string,
    snapshot?: Record<string, unknown> | null,
    notes?: string | null,
    ipAddress?: string | null,
    userAgent?: string | null
  ) {
    try {
      await prisma.change_request_events.create({
        data: {
          change_request_id: changeRequestId,
          action,
          actor_id: actorId,
          actor_role: actorRole,
          snapshot: snapshot as any ?? null,
          notes: notes ?? null,
          ip_address: ipAddress ?? null,
          user_agent: userAgent ?? null,
        },
      });
    } catch (err: any) {
      // Never let audit logging crash the main flow
      logger.error("change_request_event_write_failed", {
        cr_id: changeRequestId,
        action,
        error: err?.message,
      });
    }
  }
}

export const changeRequestService = new ChangeRequestService();
