import { prisma } from "@/lib/db";
import { currentAgreementWhere, agreementDocumentAccessibleWhere } from "./agreement-status";

export const DEFAULT_RENEWAL_GRACE_PERIOD_DAYS = 30;

export const RENEWAL_DECISION_STATES = [
  "CURRENT",
  "EXPIRING_SOON",
  "RENEWAL_AVAILABLE",
  "RENEWAL_DECISION_PENDING",
  "RENEWAL_OVERDUE_CRITICAL",
  "MOVE_OUT_IN_PROGRESS",
  "RENEWAL_BLOCKED_MOVED_OUT",
  "EXPIRED_AND_RENT_OVERDUE",
] as const;

export type RenewalDecisionState = typeof RENEWAL_DECISION_STATES[number];

const ACTIVE_MOVE_OUT_STATUSES = [
  "REQUESTED",
  "INSPECTION_PENDING",
  "INSPECTION_DONE",
  "SETTLEMENT_APPROVED",
  "PAYMENT_PENDING",
  "DISPUTED",
  "SETTLEMENT_PENDING",
  "APPROVED",
] as const;

const QUEUE_FILTERS = ["expiring", "expired", "overdue", "move_out", "all"] as const;
export type RenewalQueueFilter = typeof QUEUE_FILTERS[number];

function utcDateOnly(input: Date) {
  return new Date(Date.UTC(input.getUTCFullYear(), input.getUTCMonth(), input.getUTCDate()));
}

function dateDiffDays(target: Date, base: Date) {
  const targetDate = utcDateOnly(target);
  const baseDate = utcDateOnly(base);
  return Math.ceil((targetDate.getTime() - baseDate.getTime()) / 86_400_000);
}

function numberValue(value: unknown) {
  if (value === null || value === undefined) return 0;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function dateValue(value: unknown) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

export function resolveRenewalGracePeriodDays(hostel: any) {
  const prefs = (hostel?.preferences_config || {}) as Record<string, unknown>;
  const raw = prefs.renewal_grace_period_days;
  const numeric = Number(raw);
  if (!Number.isFinite(numeric) || numeric < 0) return DEFAULT_RENEWAL_GRACE_PERIOD_DAYS;
  return Math.round(numeric);
}

function contractSummary(agreement: any) {
  const snapshot = (agreement?.content_snapshot || {}) as Record<string, any>;
  return {
    rent: numberValue(agreement?.contract_rent ?? snapshot.monthly_rent),
    security_deposit: numberValue(agreement?.contract_security_deposit ?? snapshot.advance_deposit),
    maintenance: numberValue(agreement?.contract_maintenance ?? snapshot.maintenance_charge),
    maintenance_type: agreement?.contract_maintenance_type ?? snapshot.maintenance_type ?? null,
    payment_frequency: agreement?.contract_payment_frequency ?? snapshot.payment_frequency ?? null,
  };
}

function agreementPayload(agreement: any) {
  if (!agreement) return null;
  return {
    id: agreement.id,
    tenant_id: agreement.tenant_id,
    hostel_id: agreement.hostel_id,
    status: agreement.status,
    agreement_version: agreement.agreement_version,
    agreement_start_date: agreement.agreement_start_date,
    agreement_end_date: agreement.agreement_end_date,
    signed_at: agreement.signed_at,
    renewed_at: agreement.renewed_at,
    renewed_from_agreement_id: agreement.renewed_from_agreement_id,
    renewed_to_agreement_id: agreement.renewed_to_agreement_id,
    pdf_url: agreement.pdf_url,
    contract: contractSummary(agreement),
  };
}

function tenantPayload(tenant: any) {
  if (!tenant) return null;
  return {
    id: tenant.id,
    status: tenant.status,
    profile_id: tenant.profile_id,
    hostel_id: tenant.hostel_id,
    name: tenant.profiles?.name || tenant.name || null,
    phone: tenant.profiles?.phone || tenant.phone_1 || null,
    room: tenant.room_allocations?.[0]?.room ? {
      id: tenant.room_allocations[0].room.id,
      room_no: tenant.room_allocations[0].room.room_no,
      room_type: tenant.room_allocations[0].room.room_type,
      floor_name: tenant.room_allocations[0].room.floor_ref?.name
        ?? (tenant.room_allocations[0].room.floor != null ? `Floor ${tenant.room_allocations[0].room.floor}` : null),
    } : null,
  };
}

function hasActiveOccupancy(tenant: any) {
  return tenant?.status === "ACTIVE" && (tenant.room_allocations || []).some((allocation: any) =>
    allocation.is_active && !allocation.end_date
  );
}

function activeMoveOut(tenant: any) {
  return (tenant?.move_out_requests || []).find((request: any) =>
    (ACTIVE_MOVE_OUT_STATUSES as readonly string[]).includes(String(request.status))
  ) || null;
}

function completedMoveOut(tenant: any) {
  return (tenant?.move_out_requests || []).find((request: any) => String(request.status) === "COMPLETED") || null;
}

function hasSuccessor(agreement: any) {
  return Boolean(agreement?.renewed_to_agreement_id || agreement?.renewed_to_agreement || agreement?.renewed_agreements?.[0]);
}

function hasOverdueRent(tenant: any, today: Date) {
  return (tenant?.rent_obligations || []).some((obligation: any) => {
    if (obligation.is_superseded) return false;
    if (!["PENDING", "PARTIAL"].includes(String(obligation.status))) return false;
    const dueDate = dateValue(obligation.due_date);
    return Boolean(dueDate && dateDiffDays(dueDate, today) < 0);
  });
}

function overdueRentSummary(tenant: any, today: Date) {
  const overdue = (tenant?.rent_obligations || []).filter((obligation: any) => {
    if (obligation.is_superseded) return false;
    if (!["PENDING", "PARTIAL"].includes(String(obligation.status))) return false;
    const dueDate = dateValue(obligation.due_date);
    return Boolean(dueDate && dateDiffDays(dueDate, today) < 0);
  });
  return {
    count: overdue.length,
    amount: overdue.reduce((sum: number, obligation: any) => sum + numberValue(obligation.total_amount ?? obligation.amount), 0),
    oldest_due_date: overdue
      .map((obligation: any) => dateValue(obligation.due_date))
      .filter(Boolean)
      .sort((a: any, b: any) => a.getTime() - b.getTime())[0] || null,
  };
}

function primaryState(states: RenewalDecisionState[]) {
  const order: RenewalDecisionState[] = [
    "EXPIRED_AND_RENT_OVERDUE",
    "MOVE_OUT_IN_PROGRESS",
    "RENEWAL_BLOCKED_MOVED_OUT",
    "RENEWAL_OVERDUE_CRITICAL",
    "RENEWAL_DECISION_PENDING",
    "RENEWAL_AVAILABLE",
    "EXPIRING_SOON",
    "CURRENT",
  ];
  return order.find((state) => states.includes(state)) || "CURRENT";
}

export class RenewalDecisionService {
  constructor(private readonly db = prisma) {}

  evaluateAgreement(agreement: any, now = new Date()) {
    const tenant = agreement?.tenant;
    const endDate = dateValue(agreement?.agreement_end_date);
    const daysUntilExpiry = endDate ? dateDiffDays(endDate, now) : null;
    const daysOverdue = daysUntilExpiry !== null && daysUntilExpiry < 0 ? Math.abs(daysUntilExpiry) : 0;
    const gracePeriodDays = resolveRenewalGracePeriodDays(agreement?.hostel);
    const moveOut = activeMoveOut(tenant);
    const successor = agreement?.renewed_to_agreement || agreement?.renewed_agreements?.[0] || null;
    const activeOccupancy = hasActiveOccupancy(tenant);
    const overdueRent = hasOverdueRent(tenant, now);
    const states = new Set<RenewalDecisionState>();

    if (moveOut) states.add("MOVE_OUT_IN_PROGRESS");
    if (!activeOccupancy && completedMoveOut(tenant)) states.add("RENEWAL_BLOCKED_MOVED_OUT");

    if (agreement?.status === "SIGNED") {
      states.add("CURRENT");
    }
    if (agreement?.status === "EXPIRING_SOON") {
      states.add("EXPIRING_SOON");
    }

    const successorExists = hasSuccessor(agreement);
    const renewalEligibleStatus = ["EXPIRING_SOON", "AGREEMENT_EXPIRED"].includes(String(agreement?.status));
    const renewalAvailable = renewalEligibleStatus && !moveOut && !successorExists && activeOccupancy;
    if (renewalAvailable) states.add("RENEWAL_AVAILABLE");

    if (agreement?.status === "AGREEMENT_EXPIRED" && activeOccupancy && !moveOut && !successorExists) {
      states.add("RENEWAL_DECISION_PENDING");
      if (daysOverdue > gracePeriodDays) states.add("RENEWAL_OVERDUE_CRITICAL");
      if (overdueRent) states.add("EXPIRED_AND_RENT_OVERDUE");
    }

    if (states.size === 0) states.add("CURRENT");
    const stateList = [...states];
    const decisionState = primaryState(stateList);
    const rentSummary = overdueRentSummary(tenant, now);

    return {
      decision_state: decisionState,
      states: stateList,
      renewal_available: renewalAvailable,
      renewal_blocked_reason: moveOut
        ? "MOVE_OUT_IN_PROGRESS"
        : successorExists
          ? "SUCCESSOR_EXISTS"
          : !activeOccupancy
            ? "NO_ACTIVE_OCCUPANCY"
            : null,
      days_until_expiry: daysUntilExpiry !== null && daysUntilExpiry >= 0 ? daysUntilExpiry : null,
      days_overdue: daysOverdue,
      grace_period_days: gracePeriodDays,
      has_active_occupancy: activeOccupancy,
      has_successor: successorExists,
      move_out_status: moveOut?.status || completedMoveOut(tenant)?.status || null,
      move_out_request: moveOut ? { id: moveOut.id, status: moveOut.status, planned_exit_date: moveOut.planned_exit_date } : null,
      renewal_draft: successor ? agreementPayload(successor) : null,
      overdue_rent: rentSummary,
      current_agreement: agreementPayload(agreement),
      tenant: tenantPayload(tenant),
      contract_summary: contractSummary(agreement),
    };
  }

  async getTenantRenewalDecision(tenantId: string, now = new Date()) {
    const agreement = await this.db.agreement.findFirst({
      where: { tenant_id: tenantId, status: currentAgreementWhere() },
      include: this.agreementDecisionInclude(),
      orderBy: { generated_at: "desc" },
    });
    if (!agreement) {
      return {
        decision_state: "CURRENT" as RenewalDecisionState,
        states: ["CURRENT"] as RenewalDecisionState[],
        renewal_available: false,
        renewal_blocked_reason: "NO_CURRENT_AGREEMENT",
        current_agreement: null,
        tenant: null,
      };
    }
    return this.evaluateAgreement(agreement, now);
  }

  async getOwnerRenewalQueue(ownerId: string, options: { hostelId?: string | null; filter?: RenewalQueueFilter; now?: Date } = {}) {
    const filter = QUEUE_FILTERS.includes((options.filter || "all") as any) ? (options.filter || "all") : "all";
    const agreements = await this.db.agreement.findMany({
      where: {
        status: { in: ["EXPIRING_SOON", "AGREEMENT_EXPIRED"] },
        hostel: {
          owner_id: ownerId,
          ...(options.hostelId ? { id: options.hostelId } : {}),
        },
      },
      include: this.agreementDecisionInclude(),
      orderBy: [{ agreement_end_date: "asc" }, { generated_at: "desc" }],
    });

    const rows = agreements
      .map((agreement: any) => this.evaluateAgreement(agreement, options.now || new Date()))
      .filter((row: any) => {
        if (filter === "expiring") return row.states.includes("EXPIRING_SOON");
        if (filter === "expired") return row.states.includes("RENEWAL_DECISION_PENDING");
        if (filter === "overdue") return row.states.includes("RENEWAL_OVERDUE_CRITICAL") || row.states.includes("EXPIRED_AND_RENT_OVERDUE");
        if (filter === "move_out") return row.states.includes("MOVE_OUT_IN_PROGRESS");
        return true;
      })
      .sort((a: any, b: any) => {
        const rank = (row: any) => {
          if (row.states.includes("EXPIRED_AND_RENT_OVERDUE")) return 0;
          if (row.states.includes("RENEWAL_OVERDUE_CRITICAL")) return 1;
          if (row.states.includes("RENEWAL_DECISION_PENDING")) return 2;
          if (row.states.includes("EXPIRING_SOON")) return 3;
          if (row.states.includes("MOVE_OUT_IN_PROGRESS")) return 4;
          return 5;
        };
        return rank(a) - rank(b) || Number(b.days_overdue || 0) - Number(a.days_overdue || 0);
      });

    const counts = {
      expiring: rows.filter((row: any) => row.states.includes("EXPIRING_SOON")).length,
      expired: rows.filter((row: any) => row.states.includes("RENEWAL_DECISION_PENDING")).length,
      overdue: rows.filter((row: any) => row.states.includes("RENEWAL_OVERDUE_CRITICAL") || row.states.includes("EXPIRED_AND_RENT_OVERDUE")).length,
      move_out: rows.filter((row: any) => row.states.includes("MOVE_OUT_IN_PROGRESS")).length,
      total: rows.length,
    };

    return { filter, counts, renewals: rows };
  }

  async getAgreementHistory(input: { tenantId?: string | null; ownerId?: string | null; requesterTenantProfileId?: string | null }) {
    const where: any = { status: agreementDocumentAccessibleWhere() };
    if (input.tenantId) where.tenant_id = input.tenantId;
    if (input.ownerId) where.hostel = { owner_id: input.ownerId };
    if (input.requesterTenantProfileId) {
      where.tenant = { profile_id: input.requesterTenantProfileId };
    }

    const agreements = await this.db.agreement.findMany({
      where,
      include: {
        tenant: { select: { id: true, profile_id: true, profiles: { select: { name: true, phone: true } } } },
        hostel: { select: { id: true, name: true, owner_id: true } },
      },
      orderBy: [{ agreement_version: "desc" }, { generated_at: "desc" }],
    });

    return agreements.map((agreement: any) => ({
      id: agreement.id,
      tenant_id: agreement.tenant_id,
      tenant_name: agreement.tenant?.profiles?.name || null,
      hostel_id: agreement.hostel_id,
      hostel_name: agreement.hostel?.name || null,
      agreement_version: agreement.agreement_version || 1,
      status: agreement.status,
      agreement_start_date: agreement.agreement_start_date,
      agreement_end_date: agreement.agreement_end_date,
      signed_at: agreement.signed_at,
      renewed_at: agreement.renewed_at,
      pdf_url: agreement.pdf_url,
      renewed_from_agreement_id: agreement.renewed_from_agreement_id,
      renewed_to_agreement_id: agreement.renewed_to_agreement_id,
      is_current: ["SIGNED", "EXPIRING_SOON", "AGREEMENT_EXPIRED"].includes(String(agreement.status)),
      is_historical: ["RENEWED", "TERMINATED"].includes(String(agreement.status)),
      contract: contractSummary(agreement),
    }));
  }

  private agreementDecisionInclude() {
    return {
      hostel: { select: { id: true, name: true, owner_id: true, preferences_config: true } },
      renewed_to_agreement: true,
      renewed_agreements: {
        where: { status: { notIn: ["VOID", "TERMINATED"] } },
        orderBy: { generated_at: "desc" },
        take: 1,
      },
      tenant: {
        include: {
          profiles: { select: { name: true, phone: true } },
          room_allocations: {
            where: { is_active: true, end_date: null },
            include: {
              room: {
                select: {
                  id: true,
                  room_no: true,
                  room_type: true,
                  floor: true,
                  floor_ref: { select: { name: true } },
                },
              },
            },
            take: 1,
          },
          move_out_requests: {
            orderBy: { created_at: "desc" },
            take: 3,
          },
          rent_obligations: {
            where: { status: { in: ["PENDING", "PARTIAL"] }, is_superseded: false },
            orderBy: { due_date: "asc" },
            take: 20,
          },
        },
      },
    };
  }
}

export const renewalDecisionService = new RenewalDecisionService();
