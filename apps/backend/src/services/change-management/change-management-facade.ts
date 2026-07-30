import { prisma } from "../../../lib/db";
import { getLogger } from "../../../lib/logger";
import { ChangeCategory, ChangeApprovalLevel, ChangeRequestStatus } from "@prisma/client";
import { entityAdapterRegistry } from "./entity-adapter";
import { validationEngine } from "./validation-engine";
import { policyEngine } from "./change-policies";
import { computeDiff } from "./diff-engine";
import { simulationEngine } from "./simulation-engine";
import { domainEventsBus } from "./domain-events";
import { v4 as uuidv4 } from "uuid";

const logger = getLogger("change-management-facade");

export interface ProposeChangeInput {
  ownerId: string;
  hostelId: string;
  tenantId?: string;
  entityType: string;
  entityId: string;
  proposedChanges: Record<string, any>;
  reason: string;
  requestedBy: string;
  metadata?: Record<string, any>;
}

export interface ProposeChangeResult {
  id: string;
  status: ChangeRequestStatus;
  changeCategory: ChangeCategory;
  approvalLevel: ChangeApprovalLevel;
  applied: boolean;
  message: string;
}

export class ChangeManagementFacade {
  /**
   * Propose a change to a governed entity.
   * Classifies, validates, evaluates policies, runs simulations, and either
   * applies immediately (L1) or creates a pending request (L2/L3).
   */
proposalCounter = 0;

  async propose(input: ProposeChangeInput): Promise<ProposeChangeResult> {
    const {
      ownerId, hostelId, tenantId, entityType, entityId,
      proposedChanges, reason, requestedBy, metadata
    } = input;

    const correlationId = (metadata?.correlationId as string) || uuidv4();

    // 1. Get matching adapter
    const adapter = entityAdapterRegistry.get(entityType);

    // 2. Load current entity state
    const entity = await adapter.load(entityId, prisma);
    const beforeSnapshot = adapter.snapshot(entity);
    const currentVersion = entity.version || 1;

    // 3. Structural validation pre-checks
    await validationEngine.validate(beforeSnapshot, proposedChanges);

    // 4. Determine correction window status
    const hasPayments = entityType === "tenant_profile" && entity.payments && entity.payments.length > 0;
    const tenantStatus = entityType === "tenant_profile" ? entity.status : "INVITED";
    const correctionWindow = tenantStatus === "INVITED" && !hasPayments;

    // 5. Evaluate policy engine
    const policyResult = await policyEngine.evaluate({
      ownerId,
      hostelId,
      tenantId,
      entityType,
      entityId,
      before: beforeSnapshot,
      diff: proposedChanges,
      correctionWindow,
    });

    // 6. Compute exact changes
    const diffResult = computeDiff(beforeSnapshot, proposedChanges);
    const actualDiff = diffResult.proposedChanges;

    if (Object.keys(actualDiff).length === 0) {
      return {
        id: "",
        status: "APPLIED" as ChangeRequestStatus,
        changeCategory: policyResult.category,
        approvalLevel: policyResult.approvalLevel,
        applied: true,
        message: "No changes detected.",
      };
    }

    // 7. Run simulation if required
    if (policyResult.requiresSimulation) {
      await simulationEngine.simulate(beforeSnapshot, actualDiff);
    }

    const expiresAt = policyResult.approvalLevel === "L2" || policyResult.approvalLevel === "L3"
      ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      : null;

    if (!policyResult.requiresTenantApproval) {
      // ─── Immediate Apply (Category A / Correction Window) ───
      const result = await prisma.$transaction(async (tx) => {
        // Load entity to verify version (Optimistic concurrency check)
        const currentEntity = await adapter.load(entityId, tx);
        const dbVersion = currentEntity.version || 1;
        if (dbVersion !== currentVersion) {
          throw new Error(
            `CONCURRENCY_ERROR: Version mismatch. Expected version ${currentVersion} but found version ${dbVersion}.`
          );
        }

        // Apply mutations through adapter
        const updatedEntity = await adapter.apply(entityId, actualDiff, currentVersion, tx);

        // Record applied change request for audit history
        const cr = await tx.change_requests.create({
          data: {
            owner_id: ownerId,
            hostel_id: hostelId,
            tenant_id: tenantId || null,
            entity_type: entityType,
            entity_id: entityId,
            entity_version: currentVersion,
            correlation_id: correlationId,
            change_category: policyResult.category,
            change_type: policyResult.category === "A" ? "profile_update" : "administrative_correction",
            approval_level: policyResult.approvalLevel,
            status: "APPLIED",
            requested_by: requestedBy,
            approved_by: requestedBy,
            approved_at: new Date(),
            applied_at: new Date(),
            before: beforeSnapshot as any,
            diff: actualDiff as any,
            reason,
            metadata: metadata as any || null,
          },
        });

        // Log audit event
        await tx.change_request_events.create({
          data: {
            change_request_id: cr.id,
            action: "applied",
            actor_id: requestedBy,
            actor_role: "owner",
            snapshot: actualDiff as any,
            notes: reason,
          },
        });

        // Mark any competing pending requests as SUPERSEDED
        await tx.change_requests.updateMany({
          where: {
            entity_type: entityType,
            entity_id: entityId,
            status: "PENDING",
          },
          data: {
            status: "SUPERSEDED",
            updated_at: new Date(),
          },
        });

        return { cr, updatedEntity };
      });

      // Dispatch event post-transaction
      await domainEventsBus.publish("ChangeRequestApplied", result.cr, correlationId);

      return {
        id: result.cr.id,
        status: "APPLIED",
        changeCategory: policyResult.category,
        approvalLevel: policyResult.approvalLevel,
        applied: true,
        message: "Changes applied immediately.",
      };
    } else {
      // ─── Proposal Pending Approval (Category B / C) ───
      const cr = await prisma.$transaction(async (tx) => {
        const created = await tx.change_requests.create({
          data: {
            owner_id: ownerId,
            hostel_id: hostelId,
            tenant_id: tenantId || null,
            entity_type: entityType,
            entity_id: entityId,
            entity_version: currentVersion,
            correlation_id: correlationId,
            change_category: policyResult.category,
            change_type: policyResult.category === "C" ? "contract_amendment" : "profile_update",
            approval_level: policyResult.approvalLevel,
            status: "PENDING",
            requested_by: requestedBy,
            before: beforeSnapshot as any,
            diff: actualDiff as any,
            reason,
            expires_at: expiresAt,
            metadata: metadata as any || null,
          },
        });

        await tx.change_request_events.create({
          data: {
            change_request_id: created.id,
            action: "created",
            actor_id: requestedBy,
            actor_role: "owner",
            snapshot: actualDiff as any,
            notes: reason,
          },
        });

        return created;
      });

      // Dispatch event post-transaction
      await domainEventsBus.publish("ChangeRequestCreated", cr, correlationId);

      return {
        id: cr.id,
        status: "PENDING",
        changeCategory: policyResult.category,
        approvalLevel: policyResult.approvalLevel,
        applied: false,
        message: "Change proposal created. Awaiting tenant approval.",
      };
    }
  }

  /**
   * Approve a pending change request (typically invoked by the tenant).
   */
  async approve(
    changeRequestId: string,
    actorId: string,
    options?: { notes?: string; ipAddress?: string; userAgent?: string }
  ) {
    const now = new Date();

    const result = await prisma.$transaction(async (tx) => {
      const cr = await tx.change_requests.findUnique({
        where: { id: changeRequestId },
      });

      if (!cr) throw new Error("NOT_FOUND: Change request not found");
      if (cr.status !== "PENDING") {
        throw new Error(`VALIDATION: Cannot approve a ${cr.status} request`);
      }

      // Authorization check (tenant approval)
      if (cr.tenant_id) {
        const tenant = await tx.tenants.findUnique({
          where: { id: cr.tenant_id },
          select: { profile_id: true },
        });
        if (!tenant || tenant.profile_id !== actorId) {
          throw new Error("FORBIDDEN: Only the tenant can approve this request");
        }
      }

      const adapter = entityAdapterRegistry.get(cr.entity_type);

      if (cr.approval_level === "L2") {
        // Load entity to verify version matches entity_version (Optimistic Check)
        const entity = await adapter.load(cr.entity_id, tx);
        const currentVersion = entity.version || 1;

        if (currentVersion !== cr.entity_version) {
          throw new Error(
            `CONCURRENCY_ERROR: Entity has changed since this request was proposed. Expected version ${cr.entity_version} but found version ${currentVersion}.`
          );
        }

        // Apply mutations
        await adapter.apply(cr.entity_id, cr.diff as Record<string, any>, currentVersion, tx);

        // Update change request
        const updated = await tx.change_requests.update({
          where: { id: changeRequestId },
          data: {
            status: "APPLIED",
            approved_by: actorId,
            approved_at: now,
            applied_at: now,
            updated_at: now,
          },
        });

        // Write audit log event
        await tx.change_request_events.create({
          data: {
            change_request_id: changeRequestId,
            action: "applied",
            actor_id: actorId,
            actor_role: "tenant",
            snapshot: cr.diff as any,
            notes: options?.notes || "Tenant approved. Changes applied.",
            ip_address: options?.ipAddress || null,
            user_agent: options?.userAgent || null,
          },
        });

        // Mark other pending requests for the same entity as SUPERSEDED
        await tx.change_requests.updateMany({
          where: {
            entity_type: cr.entity_type,
            entity_id: cr.entity_id,
            status: "PENDING",
            id: { not: changeRequestId },
          },
          data: {
            status: "SUPERSEDED",
            updated_at: now,
          },
        });

        return { status: "APPLIED" as const, cr: updated };
      } else {
        // L3 remains APPROVED until Amendment Engine applies it (Phase 3)
        const updated = await tx.change_requests.update({
          where: { id: changeRequestId },
          data: {
            status: "APPROVED",
            approved_by: actorId,
            approved_at: now,
            updated_at: now,
          },
        });

        await tx.change_request_events.create({
          data: {
            change_request_id: changeRequestId,
            action: "approved",
            actor_id: actorId,
            actor_role: "tenant",
            notes: options?.notes || "Tenant approved.",
            ip_address: options?.ipAddress || null,
            user_agent: options?.userAgent || null,
          },
        });

        return { status: "APPROVED" as const, cr: updated };
      }
    });

    if (result.status === "APPLIED") {
      await domainEventsBus.publish("ChangeRequestApplied", result.cr, result.cr.correlation_id || undefined);
    } else {
      await domainEventsBus.publish("ChangeRequestApproved", result.cr, result.cr.correlation_id || undefined);
    }

    return result;
  }

  /**
   * Reject a pending change request (invoked by tenant).
   */
  async reject(
    changeRequestId: string,
    actorId: string,
    options?: { reason?: string; ipAddress?: string; userAgent?: string }
  ) {
    const now = new Date();

    const cr = await prisma.$transaction(async (tx) => {
      const pendingCr = await tx.change_requests.findUnique({
        where: { id: changeRequestId },
      });

      if (!pendingCr) throw new Error("NOT_FOUND: Change request not found");
      if (pendingCr.status !== "PENDING") {
        throw new Error(`VALIDATION: Cannot reject a ${pendingCr.status} request`);
      }

      if (pendingCr.tenant_id) {
        const tenant = await tx.tenants.findUnique({
          where: { id: pendingCr.tenant_id },
          select: { profile_id: true },
        });
        if (!tenant || tenant.profile_id !== actorId) {
          throw new Error("FORBIDDEN: Only the tenant can reject this request");
        }
      }

      const updated = await tx.change_requests.update({
        where: { id: changeRequestId },
        data: {
          status: "REJECTED",
          rejected_by: actorId,
          rejected_at: now,
          updated_at: now,
        },
      });

      await tx.change_request_events.create({
        data: {
          change_request_id: changeRequestId,
          action: "rejected",
          actor_id: actorId,
          actor_role: "tenant",
          notes: options?.reason || "Tenant rejected proposal",
          ip_address: options?.ipAddress || null,
          user_agent: options?.userAgent || null,
        },
      });

      return updated;
    });

    await domainEventsBus.publish("ChangeRequestRejected", cr, cr.correlation_id || undefined);
    return cr;
  }

  /**
   * Cancel a pending change request (invoked by owner).
   */
  async cancel(changeRequestId: string, actorId: string, reason?: string) {
    const now = new Date();

    const cr = await prisma.$transaction(async (tx) => {
      const pendingCr = await tx.change_requests.findUnique({
        where: { id: changeRequestId },
      });

      if (!pendingCr) throw new Error("NOT_FOUND: Change request not found");
      if (pendingCr.status !== "PENDING") {
        throw new Error(`VALIDATION: Cannot cancel a ${pendingCr.status} request`);
      }

      if (pendingCr.requested_by !== actorId && pendingCr.owner_id !== actorId) {
        throw new Error("FORBIDDEN: Only the requester or owner can cancel");
      }

      const updated = await tx.change_requests.update({
        where: { id: changeRequestId },
        data: {
          status: "CANCELLED",
          cancelled_at: now,
          updated_at: now,
        },
      });

      await tx.change_request_events.create({
        data: {
          change_request_id: changeRequestId,
          action: "cancelled",
          actor_id: actorId,
          actor_role: "owner",
          notes: reason || "Owner cancelled proposal",
        },
      });

      return updated;
    });

    await domainEventsBus.publish("ChangeRequestCancelled", cr, cr.correlation_id || undefined);
    return cr;
  }
}

export const changeManagementFacade = new ChangeManagementFacade();
