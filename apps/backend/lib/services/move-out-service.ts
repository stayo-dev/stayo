import { prisma } from "../db";
import { Prisma, MoveOutStatus, MoveOutReason } from "@prisma/client";
type Tx = Prisma.TransactionClient;
import { getLogger } from "../logger";
import { financialService } from "../../src/services/payments/financial-service";
import { tenantFinancialLedgerService } from "../../src/services/payments/tenant-financial-ledger-service";
import { obligationEngine } from "../../src/services/payments/obligation-engine";
import { assertTransition, assertCapability, checkCapability, getTenantSteps } from "./move-out-state-machine";
import {
  notifyMoveOutDisputeRaised,
  notifyMoveOutDisputeUpdated,
  notifyMoveOutTransition,
} from "./move-out-notifications";
import { randomUUID } from "crypto";
import { liveTenancyWhere } from "@/lib/tenancy/active-tenancy";

// Re-export capability guards for use by other services
export { assertCapability, checkCapability } from "./move-out-state-machine";

const logger = getLogger("move-out");

// ─── Types ─────────────────────────────────────────────────────
export interface CreateMoveOutParams {
  tenantId: string; hostelId: string; ownerId: string;
  initiatedBy: string; initiatedByRole: "TENANT" | "OWNER";
  reason: MoveOutReason; reasonText?: string; plannedExitDate: string;
  actor: MoveOutActor;
  isEviction?: boolean; evictionReason?: string;
}
export interface InspectionParams {
  requestId: string; inspectedBy: string; roomCondition: string; cleaningStatus: string;
  damagesAmount?: number; cleaningFee?: number; missingItemsFee?: number; otherDeductions?: number;
  deductionNotes?: string; evidenceUrls?: string[]; notes?: string;
  items?: Array<{ itemName: string; itemCategory?: string; condition: string; chargeAmount?: number; notes?: string; evidenceUrl?: string }>;
  actor: MoveOutActor;
}
export interface DisputeParams {
  requestId: string; actor: MoveOutActor;
  disputeType: string; description: string; disputedAmount?: number; evidenceUrls?: string[];
}
export interface FeedbackParams {
  requestId: string; actor: MoveOutActor;
  ratingCleanliness?: number; ratingFood?: number; ratingWifi?: number;
  ratingManagement?: number; ratingMaintenance?: number; ratingSafety?: number;
  ratingValue?: number; ratingNoise?: number; overallRating?: number;
  wouldRecommend?: boolean; improvementText?: string; experienceText?: string;
}

export interface MoveOutActor {
  id: string;
  role: string;
  ownerId?: string | null;
  tenantId?: string | null;
}

export function moveOutActorFromSession(session: { sub: string; role: string; owner_id?: string | null; tenant_id?: string | null }): MoveOutActor {
  return {
    id: session.sub,
    role: session.role,
    ownerId: session.owner_id ?? null,
    tenantId: session.tenant_id ?? null,
  };
}

type RequestAuthPolicy = {
  action: string;
  allowTenant?: boolean;
  allowOwner?: boolean;
};

const ACTIVE_DISPUTE_STATUSES = ["OPEN", "UNDER_REVIEW"];

const DISPUTE_TYPE_ALIASES: Record<string, string> = {
  DEDUCTION: "DAMAGE_CHARGE_DISPUTE",
  DEDUCTIONS: "DAMAGE_CHARGE_DISPUTE",
  DAMAGES: "DAMAGE_CHARGE_DISPUTE",
  DAMAGE: "DAMAGE_CHARGE_DISPUTE",
  RENT_DUES: "RENT_DUES_DISPUTE",
  DEPOSIT: "DEPOSIT_REFUND_DISPUTE",
  CLEANING: "CLEANING_FEE_DISPUTE",
  MISSING_ITEMS: "MISSING_ITEMS_DISPUTE",
  OTHER: "SETTLEMENT_DISPUTE",
};

function normalizeDisputeType(input: string | null | undefined) {
  const raw = String(input || "SETTLEMENT_DISPUTE").trim().toUpperCase();
  return DISPUTE_TYPE_ALIASES[raw] || raw;
}

// ─── Service ───────────────────────────────────────────────────
export class MoveOutService {

  private normalizeRole(actor: MoveOutActor) {
    return String(actor.role || "").toUpperCase();
  }

  private forbidden(action: string): never {
    throw new Error(`FORBIDDEN: Not allowed to ${action}`);
  }

  private unauthorized(): never {
    throw new Error("UNAUTHORIZED: Authentication required");
  }

  private async getRequestForAuthorization(requestId: string) {
    const req = await prisma.move_out_requests.findUnique({
      where: { id: requestId },
      include: {
        tenant: { select: { profile_id: true } },
      },
    });
    if (!req) throw new Error("NOT_FOUND: Move-out request not found");
    return req;
  }

  private async requireRequestActor(requestId: string, actor: MoveOutActor | null | undefined, policy: RequestAuthPolicy) {
    if (!actor?.id) this.unauthorized();

    const req = await this.getRequestForAuthorization(requestId);
    const role = this.normalizeRole(actor);

    if (role === "TENANT" && policy.allowTenant) {
      const ownsByProfile = req.tenant?.profile_id === actor.id;
      const ownsByTenantId = Boolean(actor.tenantId && actor.tenantId === req.tenant_id);
      if (ownsByProfile || ownsByTenantId) return req;
    }

    if (role === "OWNER" && policy.allowOwner) {
      const ownerId = actor.ownerId;
      if (ownerId && ownerId === actor.id && req.owner_id === ownerId) return req;
    }

    this.forbidden(policy.action);
  }

  private async requireDisputeActor(disputeId: string, actor: MoveOutActor | null | undefined, policy: RequestAuthPolicy) {
    if (!actor?.id) this.unauthorized();

    const dispute = await prisma.exit_disputes.findUnique({
      where: { id: disputeId },
      include: {
        request: {
          include: { tenant: { select: { profile_id: true } } },
        },
      },
    });
    if (!dispute) throw new Error("NOT_FOUND: Dispute not found");

    const req = dispute.request;
    const role = this.normalizeRole(actor);

    if (role === "TENANT" && policy.allowTenant && req.tenant?.profile_id === actor.id) return { dispute, request: req };
    if (role === "OWNER" && policy.allowOwner && actor.ownerId && actor.ownerId === actor.id && req.owner_id === actor.ownerId) {
      return { dispute, request: req };
    }

    this.forbidden(policy.action);
  }

  private async assertNoActiveDisputes(requestId: string, tx: Tx | typeof prisma = prisma) {
    const active = await tx.exit_disputes.findFirst({
      where: { request_id: requestId, status: { in: ACTIVE_DISPUTE_STATUSES } },
      select: { id: true, status: true },
      orderBy: { created_at: "desc" },
    });
    if (!active) return;

    if (active.status === "UNDER_REVIEW") {
      throw new Error(`DISPUTE_REVIEW_REQUIRED: Dispute ${active.id} is under review and must be resolved before financial completion.`);
    }
    throw new Error(`DISPUTE_OPEN: Dispute ${active.id} must be reviewed before financial completion.`);
  }

  private async logMoveOutDisputeActivity(
    tx: Tx,
    input: {
      request: { id: string; owner_id: string; hostel_id: string; tenant_id: string };
      disputeId: string;
      actorId: string;
      actionType: "DISPUTE_RAISED" | "DISPUTE_REVIEWED" | "DISPUTE_RESOLVED" | "DISPUTE_REJECTED";
      metadata?: Record<string, unknown>;
    },
  ) {
    await tx.activity_logs.create({
      data: {
        id: randomUUID(),
        user_id: input.actorId,
        owner_id: input.request.owner_id,
        action_type: input.actionType,
        entity_type: "MOVE_OUT_DISPUTE",
        entity_id: input.disputeId,
        metadata: {
          request_id: input.request.id,
          tenant_id: input.request.tenant_id,
          hostel_id: input.request.hostel_id,
          ...(input.metadata || {}),
        },
      },
    });
  }

  // ── Create Request ───────────────────────────────────────────
  async createRequest(params: CreateMoveOutParams) {
    const { tenantId, hostelId, ownerId, initiatedBy, initiatedByRole, reason, reasonText, plannedExitDate, isEviction, evictionReason, actor } = params;
    const tenant = await prisma.tenants.findUnique({
      where: { id: tenantId },
      select: { id: true, profile_id: true, status: true, owner_id: true, hostel_id: true, year_of_study: true },
    });
    if (!tenant) throw new Error("NOT_FOUND: Tenant not found");
    if (tenant.owner_id !== ownerId) throw new Error("FORBIDDEN: Tenant does not belong to this owner");
    if (tenant.hostel_id !== hostelId) throw new Error("FORBIDDEN: Tenant does not belong to this hostel");

    const role = this.normalizeRole(actor);
    if (role === "TENANT") {
      const ownsTenant = tenant.profile_id === actor.id || actor.tenantId === tenant.id;
      if (!ownsTenant || initiatedBy !== actor.id || initiatedByRole !== "TENANT") this.forbidden("create this move-out request");
    } else if (role === "OWNER") {
      if (!actor.ownerId || actor.ownerId !== actor.id || ownerId !== actor.ownerId || initiatedBy !== actor.id || initiatedByRole !== "OWNER") {
        this.forbidden("create this move-out request");
      }
    } else {
      this.forbidden("create this move-out request");
    }

    if (tenant.status !== "ACTIVE") throw new Error(`VALIDATION: Only ACTIVE tenants can request move-out. Current: ${tenant.status}`);
    if (tenant.year_of_study === 4 && reason !== "COURSE_COMPLETED") {
      throw new Error("VALIDATION: 4th-year tenants must select COURSE_COMPLETED as their move-out reason.");
    }

    const existing = await prisma.move_out_requests.findFirst({
      where: { tenant_id: tenantId, status: { notIn: ["COMPLETED", "REJECTED"] } },
    });
    if (existing) throw new Error(`VALIDATION: Active move-out request already exists (${existing.id})`);

    const hostel = await prisma.hostels.findUnique({ where: { id: hostelId }, select: { preferences_config: true } });
    const noticePeriodDays = ((hostel?.preferences_config as any) || {}).notice_period_days ?? 30;
    const exitDate = new Date(plannedExitDate);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const diffDays = Math.ceil((exitDate.getTime() - today.getTime()) / (86400000));
    const violation = diffDays < noticePeriodDays;

    const request = await prisma.$transaction(async (tx: Tx) => {
      const req = await tx.move_out_requests.create({
        data: {
          tenant_id: tenantId, hostel_id: hostelId, owner_id: ownerId,
          status: "REQUESTED", reason, reason_text: reasonText || null,
          planned_exit_date: exitDate, notice_period_days: noticePeriodDays,
          notice_period_violation: violation, initiated_by: initiatedBy,
          initiated_by_role: initiatedByRole, is_eviction: isEviction || false,
          eviction_reason: evictionReason || null,
        },
      });
      await tx.tenants.update({ where: { id: tenantId }, data: { updated_at: new Date() } });
      return req;
    });
    logger.info("move_out.created", { id: request.id, tenant_id: tenantId, eviction: isEviction });
    await notifyMoveOutTransition(request.id, "REQUESTED");
    return { request, notice_period_violation: violation, notice_period_days: noticePeriodDays };
  }

  // ── Cancel Request ───────────────────────────────────────────
  async cancelRequest(requestId: string, actor: MoveOutActor, reason?: string) {
    const req = await this.requireRequestActor(requestId, actor, {
      action: "cancel this move-out request",
      allowTenant: true,
      allowOwner: true,
    });
    assertTransition(req.status as MoveOutStatus, "REJECTED");
    return prisma.$transaction(async (tx: Tx) => {
      const updated = await tx.move_out_requests.update({
        where: { id: requestId },
        data: { status: "REJECTED", cancelled_at: new Date(), cancelled_by: actor.id, cancellation_reason: reason || null, updated_at: new Date() },
      });
      await tx.tenants.update({ where: { id: req.tenant_id }, data: { updated_at: new Date() } });
      notifyMoveOutTransition(requestId, "REJECTED");
      return updated;
    });
  }

  // ── Reject Request ───────────────────────────────────────────
  async rejectRequest(requestId: string, actor: MoveOutActor, reason?: string) {
    const req = await this.requireRequestActor(requestId, actor, {
      action: "reject this move-out request",
      allowOwner: true,
    });
    assertTransition(req.status as MoveOutStatus, "REJECTED");
    return prisma.$transaction(async (tx: Tx) => {
      const updated = await tx.move_out_requests.update({
        where: { id: requestId },
        data: { status: "REJECTED", cancelled_at: new Date(), cancelled_by: actor.id, cancellation_reason: reason || null, updated_at: new Date() },
      });
      await tx.tenants.update({ where: { id: req.tenant_id }, data: { updated_at: new Date() } });
      notifyMoveOutTransition(requestId, "REJECTED");
      return updated;
    });
  }

  // ── Submit Inspection ────────────────────────────────────────
  async submitInspection(params: InspectionParams) {
    const req = await this.requireRequestActor(params.requestId, params.actor, {
      action: "inspect this move-out request",
      allowOwner: true,
    });
    assertTransition(req.status as MoveOutStatus, "SETTLEMENT_PENDING");
    const totalDeductions = (params.damagesAmount || 0) + (params.cleaningFee || 0) + (params.missingItemsFee || 0) + (params.otherDeductions || 0);

    return prisma.$transaction(async (tx: Tx) => {
      const inspection = await tx.move_out_inspections.upsert({
        where: { request_id: params.requestId },
        create: {
          request_id: params.requestId, inspected_by: params.inspectedBy,
          room_condition: params.roomCondition || "GOOD", cleaning_status: params.cleaningStatus || "CLEAN",
          damages_amount: params.damagesAmount || 0, cleaning_fee: params.cleaningFee || 0,
          missing_items_fee: params.missingItemsFee || 0, other_deductions: params.otherDeductions || 0,
          total_deductions: totalDeductions, deduction_notes: params.deductionNotes || null,
          evidence_urls: params.evidenceUrls || [], notes: params.notes || null,
        },
        update: {
          inspected_by: params.inspectedBy, room_condition: params.roomCondition || "GOOD",
          cleaning_status: params.cleaningStatus || "CLEAN", damages_amount: params.damagesAmount || 0,
          cleaning_fee: params.cleaningFee || 0, missing_items_fee: params.missingItemsFee || 0,
          other_deductions: params.otherDeductions || 0, total_deductions: totalDeductions,
          deduction_notes: params.deductionNotes || null, evidence_urls: params.evidenceUrls || [],
          notes: params.notes || null, updated_at: new Date(),
        },
      });
      // Structured inspection items
      if (params.items?.length) {
        await tx.move_out_inspection_items.deleteMany({ where: { request_id: params.requestId } });
        await tx.move_out_inspection_items.createMany({
          data: params.items.map(i => ({
            request_id: params.requestId, item_name: i.itemName,
            item_category: i.itemCategory || "FURNITURE", condition: i.condition,
            charge_amount: i.chargeAmount || 0, notes: i.notes || null, evidence_url: i.evidenceUrl || null,
          })),
        });
      }
      await tx.move_out_requests.update({ where: { id: params.requestId }, data: { status: "SETTLEMENT_PENDING", updated_at: new Date() } });
      notifyMoveOutTransition(params.requestId, "SETTLEMENT_PENDING");
      return inspection;
    });
  }

  // ── Settlement Preview (read-only) ──────────────────────────
  async calculateSettlementPreview(requestId: string) {
    const req = await prisma.move_out_requests.findUnique({ where: { id: requestId }, include: { tenant: true, inspection: true } });
    if (!req) throw new Error("NOT_FOUND: Move-out request not found");

    const configuredSecurityDeposit = Number(req.tenant.security_deposit || 0);
    const advBal = await tenantFinancialLedgerService.getBalance(req.tenant_id, req.owner_id);
    const paidAdvanceBalance = Math.max(0, Number(advBal.balance || 0));

    // Fetch total paid amount against ADVANCE obligations (which represents the security deposit paid outside the ledger/already adjusted)
    const paidAdvanceObligations = await prisma.payments.aggregate({
      where: {
        tenant_id: req.tenant_id,
        obligation: {
          obligation_type: { in: ["SECURITY_DEPOSIT", "ADVANCE"] },
        },
      },
      _sum: {
        amount_paid: true,
      },
    });
    const paidAdvanceObligationSum = Number(paidAdvanceObligations?._sum?.amount_paid || 0);

    // Calculate the remaining security deposit that needs to be held/reserved in the ledger
    const remainingSecurityDepositFromLedger = Math.max(0, configuredSecurityDeposit - paidAdvanceObligationSum);

    // The portion of the ledger balance that represents the security deposit
    const ledgerSecurityDeposit = Math.min(paidAdvanceBalance, remainingSecurityDepositFromLedger);

    // Extra advance balance in the ledger (exceeding the security deposit portion)
    const extraAdvanceBalance = Math.max(0, paidAdvanceBalance - ledgerSecurityDeposit);

    // Total paid security deposit (ledger portion + obligation portion)
    const paidSecurityDeposit = Math.min(configuredSecurityDeposit, ledgerSecurityDeposit + paidAdvanceObligationSum);

    const dues = await financialService.getTenantDues(req.tenant_id, req.owner_id, req.hostel_id);
    const insp = req.inspection;
    const totalDeductions = Number(insp?.total_deductions || 0);
    const rentDue = Number(dues.rent_due || 0);
    const lateFeesDue = Number(dues.late_fees_due || 0);
    const maintenanceAndOtherDues = Math.max(0, Number(dues.total_due || 0) - rentDue - lateFeesDue);
    const totalDues = Number(dues.total_due || 0);
    const net = paidSecurityDeposit + extraAdvanceBalance - totalDues - totalDeductions;

    return {
      request_id: requestId,
      configured_security_deposit_amount: round2(configuredSecurityDeposit),
      security_deposit_amount: round2(paidSecurityDeposit),
      advance_balance: round2(extraAdvanceBalance),
      total_paid_advance_balance: round2(paidAdvanceBalance),
      pending_rent_dues: round2(rentDue),
      pending_late_fees: round2(lateFeesDue),
      pending_utility_dues: round2(maintenanceAndOtherDues),
      damages_deduction: round2(Number(insp?.damages_amount || 0)),
      cleaning_deduction: round2(Number(insp?.cleaning_fee || 0)),
      missing_items_deduction: round2(Number(insp?.missing_items_fee || 0)),
      other_deductions: round2(Number(insp?.other_deductions || 0)),
      total_deductions: round2(totalDeductions),
      total_dues: round2(totalDues),
      net_settlement_amount: round2(net),
      settlement_direction: net > 0 ? "OWNER_OWES_TENANT" : net < 0 ? "TENANT_OWES_OWNER" : "SETTLED",
    };
  }

  // ── Approve Settlement → SETTLEMENT_APPROVED ─────────
  async approveSettlement(
    requestId: string,
    actor: MoveOutActor,
    reviewNotes?: string,
    confirmedSettlement?: { amount?: number; direction?: string },
  ) {
    const req = await this.requireRequestActor(requestId, actor, {
      action: "approve this move-out settlement",
      allowOwner: true,
    });
    const preview = applyConfirmedSettlement(
      await this.calculateSettlementPreview(requestId),
      confirmedSettlement,
    );
    assertTransition(req.status as MoveOutStatus, "SETTLEMENT_APPROVED" as MoveOutStatus);
    await this.assertNoActiveDisputes(requestId);

    return prisma.$transaction(async (tx: Tx) => {
      await this.assertNoActiveDisputes(requestId, tx);
      await tx.exit_settlement_transactions.upsert({
        where: { request_id: requestId },
        create: { request_id: requestId, tenant_id: req.tenant_id, owner_id: req.owner_id, hostel_id: req.hostel_id, ...snapshotFromPreview(preview) },
        update: { ...snapshotFromPreview(preview), updated_at: new Date() },
      });
      await tx.move_out_requests.update({
        where: { id: requestId },
        data: {
          status: "SETTLEMENT_APPROVED" as MoveOutStatus, reviewed_by: actor.id, reviewed_at: new Date(),
          review_notes: reviewNotes || null, updated_at: new Date(),
        },
      });

      notifyMoveOutTransition(requestId, "SETTLEMENT_APPROVED");
      return { ...preview, status: "SETTLEMENT_APPROVED" as MoveOutStatus };
    });
  }

  // ── Vacate Bed → PHYSICALLY_VACATED ─────────────────────────
  async vacate(requestId: string, actor: MoveOutActor, physicalExitDate?: string) {
    const req = await this.requireRequestActor(requestId, actor, {
      action: "vacate this move-out request",
      allowOwner: true,
    });
    assertTransition(req.status as MoveOutStatus, "PHYSICALLY_VACATED" as MoveOutStatus);

    const now = new Date();
    const exitDate = physicalExitDate ? new Date(physicalExitDate) : req.planned_exit_date;
    const isFutureExit = exitDate.getTime() > now.getTime();

    return prisma.$transaction(async (tx: Tx) => {
      await tx.move_out_requests.update({
        where: { id: requestId },
        data: {
          status: "PHYSICALLY_VACATED" as MoveOutStatus,
          physical_exit_date: exitDate,
          actual_exit_date: exitDate,
          room_release_date: isFutureExit ? null : exitDate,
          updated_at: now,
        },
      });

      if (!isFutureExit) {
        // Terminate the room allocation
        await tx.roomAllocation.updateMany({
          where: { tenant_id: req.tenant_id, is_active: true, end_date: null },
          data: { is_active: false, end_date: exitDate },
        });

        // Update tenant status to FORMER_TENANT
        await tx.tenants.update({
          where: { id: req.tenant_id },
          data: {
            status: "FORMER_TENANT",
            exit_date: exitDate,
            exit_reason: req.reason,
            exit_notes: req.reason_text,
            updated_at: now,
          },
        });
      } else {
        // Future exit: do NOT terminate allocation and do NOT mark as FORMER_TENANT yet.
        // Save the exit date and reasons for occupancy tracking.
        await tx.tenants.update({
          where: { id: req.tenant_id },
          data: {
            exit_date: exitDate,
            exit_reason: req.reason,
            exit_notes: req.reason_text,
            updated_at: now,
          },
        });
      }

      logger.info("move_out.vacated", { id: requestId, tenant_id: req.tenant_id });
      notifyMoveOutTransition(requestId, "PHYSICALLY_VACATED");
      return { success: true, request_id: requestId, status: "PHYSICALLY_VACATED" };
    });
  }

  // ── Confirm Payment → COMPLETED ─────────────────────────────
  async confirmPaymentAndComplete(params: { requestId: string; actor: MoveOutActor; paymentMethod?: string; paymentReference?: string; paymentNotes?: string }) {
    await this.requireRequestActor(params.requestId, params.actor, {
      action: "complete this move-out request",
      allowOwner: true,
    });
    const req = await prisma.move_out_requests.findUnique({
      where: { id: params.requestId },
      include: { settlement: true, tenant: { select: { owner_id: true } } },
    });
    if (!req) throw new Error("NOT_FOUND: Move-out request not found");
    assertTransition(req.status as MoveOutStatus, "COMPLETED");
    await this.assertNoActiveDisputes(params.requestId);
    const now = new Date();

    return prisma.$transaction(async (tx: Tx) => {
      await this.assertNoActiveDisputes(params.requestId, tx);
      if (req.settlement) {
        await tx.exit_settlement_transactions.update({
          where: { id: req.settlement.id },
          data: { payment_status: "SETTLED", payment_method: params.paymentMethod || "CASH", payment_reference: params.paymentReference || null, payment_notes: params.paymentNotes || null, settled_at: now, settled_by: params.actor.id, confirmed_by_owner: true, updated_at: now },
        });
        await applyAdvanceSettlementInTx(tx, req.settlement.id, params.actor.id, now);
      }

      // Waive outstanding rent obligations — routed through ObligationEngine
      // so any PARTIAL obligation (real payments on record) gets a proper
      // ledger correction instead of a silent status flip.
      const toWaive = await tx.rent_obligations.findMany({
        where: { tenant_id: req.tenant_id, status: { in: ["PENDING", "PARTIAL"] } },
        select: { id: true },
      });
      if (toWaive.length > 0 && req.tenant?.owner_id) {
        await obligationEngine.bulkWaiveInTx(tx, {
          obligationIds: toWaive.map((o: any) => o.id),
          reason: "Move-out settlement confirmed — outstanding rent waived",
          actorId: req.tenant.owner_id,
        });
      }

      await tx.move_out_requests.update({
        where: { id: params.requestId },
        data: { status: "COMPLETED", financial_completion_date: now, completed_at: now, updated_at: now },
      });

      logger.info("move_out.completed", { id: params.requestId, tenant_id: req.tenant_id });
      notifyMoveOutTransition(params.requestId, "COMPLETED");
      return { success: true, request_id: params.requestId };
    });
  }

  // ── Raise Dispute ────────────────────────────────────────────
  async raiseDispute(params: DisputeParams) {
    const req = await this.requireRequestActor(params.requestId, params.actor, {
      action: "raise a dispute on this move-out request",
      allowTenant: true,
      allowOwner: true,
    });
    const dispute = await prisma.$transaction(async (tx: Tx) => {
      const existing = await tx.exit_disputes.findFirst({
        where: { request_id: params.requestId, status: { in: ACTIVE_DISPUTE_STATUSES } },
        select: { id: true, status: true },
      });
      if (existing) {
        throw new Error(`DISPUTE_OPEN: Active dispute ${existing.id} is already ${existing.status}.`);
      }

      const disputeType = normalizeDisputeType(params.disputeType);
      const dispute = await tx.exit_disputes.create({
        data: { request_id: params.requestId, raised_by: params.actor.id, raised_by_role: this.normalizeRole(params.actor), dispute_type: disputeType, description: params.description, disputed_amount: params.disputedAmount || null, evidence_urls: params.evidenceUrls || [] },
      });
      await this.logMoveOutDisputeActivity(tx, {
        request: req,
        disputeId: dispute.id,
        actorId: params.actor.id,
        actionType: "DISPUTE_RAISED",
        metadata: {
          dispute_type: disputeType,
          disputed_amount: params.disputedAmount || null,
          raised_by_role: this.normalizeRole(params.actor),
        },
      });
      return dispute;
    });
    await notifyMoveOutDisputeRaised(dispute.id);
    return dispute;
  }

  async reviewDispute(disputeId: string, actor: MoveOutActor, reviewNotes?: string) {
    const { dispute, request } = await this.requireDisputeActor(disputeId, actor, {
      action: "review this move-out dispute",
      allowOwner: true,
    });
    if (!ACTIVE_DISPUTE_STATUSES.includes(dispute.status)) {
      throw new Error(`VALIDATION: Dispute is already ${dispute.status}`);
    }

    const result = await prisma.$transaction(async (tx: Tx) => {
      const updated = await tx.exit_disputes.update({
        where: { id: disputeId },
        data: {
          status: "UNDER_REVIEW",
          resolution_notes: reviewNotes || dispute.resolution_notes || null,
          updated_at: new Date(),
        },
      });
      await this.logMoveOutDisputeActivity(tx, {
        request,
        disputeId,
        actorId: actor.id,
        actionType: "DISPUTE_REVIEWED",
        metadata: { review_notes: reviewNotes || null },
      });
      return { reviewed: true, dispute: updated };
    });
    await notifyMoveOutDisputeUpdated(disputeId, "UNDER_REVIEW");
    return result;
  }

  // ── Resolve Dispute ──────────────────────────────────────────
  async resolveDispute(disputeId: string, actor: MoveOutActor, resolutionNotes: string) {
    const { dispute, request } = await this.requireDisputeActor(disputeId, actor, {
      action: "resolve this move-out dispute",
      allowOwner: true,
    });
    if (!ACTIVE_DISPUTE_STATUSES.includes(dispute.status)) {
      throw new Error(`VALIDATION: Dispute is already ${dispute.status}`);
    }
    const result = await prisma.$transaction(async (tx: Tx) => {
      const now = new Date();
      const updated = await tx.exit_disputes.update({ where: { id: disputeId }, data: { status: "RESOLVED", resolved_by: actor.id, resolution_notes: resolutionNotes, resolved_at: now, updated_at: now } });
      const openCount = await tx.exit_disputes.count({ where: { request_id: dispute.request_id, status: { in: ACTIVE_DISPUTE_STATUSES }, id: { not: disputeId } } });
      await this.logMoveOutDisputeActivity(tx, {
        request,
        disputeId,
        actorId: actor.id,
        actionType: "DISPUTE_RESOLVED",
        metadata: { resolution_notes: resolutionNotes || null },
      });
      return { resolved: true, remaining_disputes: openCount, dispute: updated };
    });
    await notifyMoveOutDisputeUpdated(disputeId, "RESOLVED");
    return result;
  }

  async rejectDispute(disputeId: string, actor: MoveOutActor, rejectionNotes: string) {
    const { dispute, request } = await this.requireDisputeActor(disputeId, actor, {
      action: "reject this move-out dispute",
      allowOwner: true,
    });
    if (!ACTIVE_DISPUTE_STATUSES.includes(dispute.status)) {
      throw new Error(`VALIDATION: Dispute is already ${dispute.status}`);
    }

    const result = await prisma.$transaction(async (tx: Tx) => {
      const now = new Date();
      const updated = await tx.exit_disputes.update({
        where: { id: disputeId },
        data: {
          status: "REJECTED",
          resolved_by: actor.id,
          resolution_notes: rejectionNotes,
          resolved_at: now,
          updated_at: now,
        },
      });
      const openCount = await tx.exit_disputes.count({ where: { request_id: dispute.request_id, status: { in: ACTIVE_DISPUTE_STATUSES }, id: { not: disputeId } } });
      await this.logMoveOutDisputeActivity(tx, {
        request,
        disputeId,
        actorId: actor.id,
        actionType: "DISPUTE_REJECTED",
        metadata: { rejection_notes: rejectionNotes || null },
      });
      return { rejected: true, remaining_disputes: openCount, dispute: updated };
    });
    await notifyMoveOutDisputeUpdated(disputeId, "REJECTED");
    return result;
  }

  // ── Submit Feedback ──────────────────────────────────────────
  async submitFeedback(params: FeedbackParams) {
    const req = await this.requireRequestActor(params.requestId, params.actor, {
      action: "submit feedback for this move-out request",
      allowTenant: true,
      allowOwner: true,
    });
    if (req.status !== "COMPLETED") throw new Error("VALIDATION: Feedback only after completion");
    const existing = await prisma.exit_feedbacks.findUnique({ where: { request_id: params.requestId } });
    if (existing) throw new Error("VALIDATION: Feedback already submitted");
    const c = (v?: number) => v != null ? Math.max(1, Math.min(5, v)) : null;
    return prisma.exit_feedbacks.create({
      data: {
        request_id: params.requestId, tenant_id: req.tenant_id, hostel_id: req.hostel_id,
        rating_cleanliness: c(params.ratingCleanliness), rating_food: c(params.ratingFood),
        rating_wifi: c(params.ratingWifi), rating_management: c(params.ratingManagement),
        rating_maintenance: c(params.ratingMaintenance), rating_safety: c(params.ratingSafety),
        rating_value: c(params.ratingValue), rating_noise: c(params.ratingNoise),
        overall_rating: c(params.overallRating), would_recommend: params.wouldRecommend ?? null,
        improvement_text: params.improvementText || null, experience_text: params.experienceText || null,
      },
    });
  }

  // ── Queries ──────────────────────────────────────────────────
  async getRequestById(requestId: string) {
    const r = await prisma.move_out_requests.findUnique({
      where: { id: requestId },
      include: {
        inspection: true, inspection_items: true, settlement: true, feedback: true,
        disputes: { orderBy: { created_at: "desc" } },
        tenant: { include: { profiles: { select: { name: true, email: true, phone: true } }, room_allocations: { where: { is_active: true }, include: { room: { select: { room_no: true, floor: true } } }, take: 1 } } },
      },
    });
    if (!r) throw new Error("NOT_FOUND");
    return r;
  }

  async listRequests(params: { ownerId: string; hostelId: string; status?: string; limit?: number; offset?: number }) {
    const where: any = { owner_id: params.ownerId, hostel_id: params.hostelId };
    if (params.status) where.status = params.status;
    const [requests, total] = await Promise.all([
      prisma.move_out_requests.findMany({
        where, include: {
          tenant: {
            include: {
              profiles: { select: { name: true, email: true, phone: true } },
              room_allocations: { where: { is_active: true }, include: { room: { select: { room_no: true } } }, take: 1 },
            },
          },
          settlement: { select: { net_settlement_amount: true, payment_status: true, settlement_direction: true } },
          disputes: {
            where: { status: { in: ACTIVE_DISPUTE_STATUSES } },
            orderBy: { created_at: "desc" },
          },
        }, orderBy: { created_at: "desc" }, take: params.limit || 50, skip: params.offset || 0,
      }),
      prisma.move_out_requests.count({ where }),
    ]);
    requests.sort((a: any, b: any) => Number((b.disputes || []).length > 0) - Number((a.disputes || []).length > 0));
    return { requests, total };
  }

  async getRequestForTenant(profileId: string) {
    const tenant = await prisma.tenants.findFirst({ where: liveTenancyWhere(profileId), select: { id: true } });
    if (!tenant) throw new Error("NOT_FOUND");
    return prisma.move_out_requests.findFirst({
      where: {
        tenant_id: tenant.id,
        OR: [
          { status: { notIn: ["COMPLETED", "REJECTED"] } },
          {
            status: "COMPLETED",
            feedback: { is: null },
          },
        ],
      },
      include: { inspection: true, settlement: true, feedback: true, disputes: { orderBy: { created_at: "desc" } } },
      orderBy: { created_at: "desc" },
    });
  }

  // ── Vacancy Pipeline ─────────────────────────────────────────
  async getUpcomingVacancies(ownerId: string, hostelId: string, daysAhead = 30) {
    return prisma.move_out_requests.findMany({
      where: {
        owner_id: ownerId, hostel_id: hostelId,
        status: { in: ["REQUESTED", "SETTLEMENT_PENDING", "SETTLEMENT_APPROVED", "APPROVED"] as MoveOutStatus[] },
        planned_exit_date: { lte: new Date(Date.now() + daysAhead * 86400000) },
      },
      include: { tenant: { include: { profiles: { select: { name: true } }, room_allocations: { where: { is_active: true }, include: { room: { select: { room_no: true, floor: true } } }, take: 1 } } } },
      orderBy: { planned_exit_date: "asc" },
    });
  }

  // ── Churn Analytics (deep) ───────────────────────────────────
  async getChurnAnalytics(ownerId: string, hostelId: string) {
    const [reasonBreakdown, monthlyExits, avgStay, roomChurn, feedbackAvgs] = await Promise.all([
      prisma.move_out_requests.groupBy({ by: ["reason"], where: { owner_id: ownerId, hostel_id: hostelId, status: "COMPLETED" }, _count: true, orderBy: { _count: { reason: "desc" } } }),
      prisma.$queryRaw<Array<{ month: string; count: number }>>`SELECT TO_CHAR(completed_at,'YYYY-MM') AS month, COUNT(*)::int AS count FROM move_out_requests WHERE owner_id=${ownerId}::uuid AND hostel_id=${hostelId}::uuid AND status='COMPLETED' AND completed_at >= NOW()-INTERVAL '12 months' GROUP BY 1 ORDER BY 1`,
      prisma.$queryRaw<Array<{ avg_days: number }>>`SELECT COALESCE(AVG(EXTRACT(DAY FROM (mor.completed_at-t.joined_on))),0)::float AS avg_days FROM move_out_requests mor JOIN tenants t ON t.id=mor.tenant_id WHERE mor.owner_id=${ownerId}::uuid AND mor.hostel_id=${hostelId}::uuid AND mor.status='COMPLETED' AND t.joined_on IS NOT NULL`,
      prisma.$queryRaw<Array<{ room_no: string; count: number }>>`SELECT r.room_no, COUNT(*)::int AS count FROM move_out_requests mor JOIN tenants t ON t.id=mor.tenant_id JOIN room_allocations ra ON ra.tenant_id=t.id JOIN rooms r ON r.id=ra.room_id WHERE mor.owner_id=${ownerId}::uuid AND mor.hostel_id=${hostelId}::uuid AND mor.status='COMPLETED' GROUP BY r.room_no ORDER BY count DESC LIMIT 10`,
      prisma.$queryRaw<Array<{ dim: string; avg: number }>>`SELECT unnest(ARRAY['cleanliness','food','wifi','management','maintenance','safety','value','noise']) AS dim, unnest(ARRAY[AVG(rating_cleanliness),AVG(rating_food),AVG(rating_wifi),AVG(rating_management),AVG(rating_maintenance),AVG(rating_safety),AVG(rating_value),AVG(rating_noise)])::float AS avg FROM exit_feedbacks WHERE hostel_id=${hostelId}::uuid`,
    ]);

    const vacancies = await this.getUpcomingVacancies(ownerId, hostelId);

    return {
      reason_breakdown: reasonBreakdown.map((r: any) => ({ reason: r.reason, count: r._count })),
      monthly_exits: monthlyExits,
      average_stay_days: Math.round(avgStay[0]?.avg_days || 0),
      room_churn_hotspots: roomChurn,
      feedback_averages: feedbackAvgs,
      upcoming_vacancies: vacancies.map((v: any) => ({
        request_id: v.id, tenant_name: v.tenant?.profiles?.name || "Unknown",
        room_no: v.tenant?.room_allocations?.[0]?.room?.room_no || null,
        planned_exit_date: v.planned_exit_date, status: v.status,
      })),
    };
  }
}

function round2(n: number) { return Math.round(n * 100) / 100; }

function applyConfirmedSettlement(
  preview: any,
  confirmed?: { amount?: number; direction?: string },
) {
  if (!confirmed || confirmed.amount == null || !confirmed.direction) return preview;

  const amount = round2(Math.max(0, Number(confirmed.amount)));
  if (!Number.isFinite(amount)) throw new Error("VALIDATION: Settlement amount must be a valid number");

  const direction = String(confirmed.direction).toUpperCase();
  if (!["OWNER_OWES_TENANT", "TENANT_OWES_OWNER", "SETTLED"].includes(direction)) {
    throw new Error("VALIDATION: Invalid settlement direction");
  }

  const net = direction === "OWNER_OWES_TENANT" ? amount : direction === "TENANT_OWES_OWNER" ? -amount : 0;
  return {
    ...preview,
    net_settlement_amount: round2(net),
    settlement_direction: direction,
  };
}

async function getAdvanceBalanceInTx(tx: Tx, tenantId: string): Promise<number> {
  const [credits, debits] = await Promise.all([
    tx.tenant_financial_ledger.aggregate({
      where: { tenant_id: tenantId, type: "CREDIT" },
      _sum: { amount: true },
    }),
    tx.tenant_financial_ledger.aggregate({
      where: { tenant_id: tenantId, type: "DEBIT" },
      _sum: { amount: true },
    }),
  ]);
  return round2(Number(credits._sum.amount ?? 0) - Number(debits._sum.amount ?? 0));
}

async function createAdvanceDebitInTx(
  tx: Tx,
  params: {
    tenantId: string;
    ownerId: string;
    hostelId: string;
    actorId: string;
    amount: number;
    balanceAfter: number;
    reason: "DEDUCTION" | "REFUND";
    referenceId: string;
    referenceType: string;
    notes: string;
    refundStatus?: "COMPLETED";
  }
) {
  if (params.amount <= 0) return;
  await tx.tenant_financial_ledger.create({
    data: {
      id: randomUUID(),
      tenant_id: params.tenantId,
      owner_id: params.ownerId,
      hostel_id: params.hostelId,
      type: "DEBIT",
      reason: params.reason === "DEDUCTION" ? "SECURITY_DEPOSIT_DEDUCTION" : params.reason === "REFUND" ? "SECURITY_DEPOSIT_REFUNDED" : params.reason as any,
      amount: round2(params.amount),
      balance_after: round2(Math.max(0, params.balanceAfter)),
      notes: params.notes,
      reference_id: params.referenceId,
      reference_type: params.referenceType,
      refund_status: params.refundStatus ?? null,
      created_by: params.actorId,
    },
  });
}

async function applyAdvanceSettlementInTx(tx: Tx, settlementId: string, actorId: string, now: Date) {
  const settlement = await tx.exit_settlement_transactions.findUnique({
    where: { id: settlementId },
    select: {
      id: true,
      tenant_id: true,
      owner_id: true,
      hostel_id: true,
      security_deposit_amount: true,
      future_rent_credit_balance: true,
      net_settlement_amount: true,
      settlement_direction: true,
    },
  });
  if (!settlement) return;

  const existing = await tx.tenant_financial_ledger.findFirst({
    where: {
      reference_id: settlement.id,
      reference_type: { in: ["MOVE_OUT_ADVANCE_DEDUCTION", "MOVE_OUT_ADVANCE_REFUND"] },
    },
    select: { id: true },
  });
  if (existing) return;

  await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${settlement.tenant_id}::uuid FOR UPDATE`;

  const currentBalance = Math.max(0, await getAdvanceBalanceInTx(tx, settlement.tenant_id));
  const settlementAdvance = round2(Number(settlement.security_deposit_amount || 0) + Number(settlement.future_rent_credit_balance || 0));
  const debitTotal = Math.min(currentBalance, settlementAdvance);
  if (debitTotal <= 0) return;

  const refundAmount = settlement.settlement_direction === "OWNER_OWES_TENANT"
    ? Math.min(debitTotal, Math.max(0, Number(settlement.net_settlement_amount || 0)))
    : 0;
  const appliedAmount = round2(debitTotal - refundAmount);

  let balanceAfter = currentBalance;
  if (appliedAmount > 0) {
    balanceAfter = round2(balanceAfter - appliedAmount);
    await createAdvanceDebitInTx(tx, {
      tenantId: settlement.tenant_id,
      ownerId: settlement.owner_id,
      hostelId: settlement.hostel_id,
      actorId,
      amount: appliedAmount,
      balanceAfter,
      reason: "DEDUCTION",
      referenceId: settlement.id,
      referenceType: "MOVE_OUT_ADVANCE_DEDUCTION",
      notes: "Move-out settlement applied advance/deposit against dues and deductions",
    });
  }

  if (refundAmount > 0) {
    balanceAfter = round2(balanceAfter - refundAmount);
    await createAdvanceDebitInTx(tx, {
      tenantId: settlement.tenant_id,
      ownerId: settlement.owner_id,
      hostelId: settlement.hostel_id,
      actorId,
      amount: refundAmount,
      balanceAfter,
      reason: "REFUND",
      referenceId: settlement.id,
      referenceType: "MOVE_OUT_ADVANCE_REFUND",
      notes: `Move-out settlement refund completed on ${now.toISOString()}`,
      refundStatus: "COMPLETED",
    });
  }
}

function snapshotFromPreview(p: any) {
  return {
    security_deposit_amount: p.security_deposit_amount, future_rent_credit_balance: p.advance_balance,
    pending_rent_dues: p.pending_rent_dues, pending_late_fees: p.pending_late_fees,
    pending_utility_dues: p.pending_utility_dues, damages_deduction: p.damages_deduction,
    cleaning_deduction: p.cleaning_deduction, missing_items_deduction: p.missing_items_deduction,
    other_deductions: p.other_deductions, total_deductions: p.total_deductions,
    total_dues: p.total_dues, net_settlement_amount: p.net_settlement_amount,
    settlement_direction: p.settlement_direction,
  };
}

export const moveOutService = new MoveOutService();
