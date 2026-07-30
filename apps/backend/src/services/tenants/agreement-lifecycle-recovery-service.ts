import { prisma } from "@/lib/db";
import { agreementDocumentAccessibleWhere } from "./agreement-status";

type LifecycleRecoveryInput = {
  agreement_start_date?: unknown;
  agreement_end_date?: unknown;
  agreement_duration_months?: unknown;
};

type AgreementLifecycleRecoveryErrorCode =
  | "AGREEMENT_NOT_FOUND"
  | "AGREEMENT_NOT_RECOVERABLE"
  | "VALIDATION_ERROR"
  | "CONTRACT_SNAPSHOT_INCOMPLETE";

export class AgreementLifecycleRecoveryError extends Error {
  code: AgreementLifecycleRecoveryErrorCode;
  status: number;
  details?: Record<string, unknown>;

  constructor(
    code: AgreementLifecycleRecoveryErrorCode,
    message: string,
    status = 400,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "AgreementLifecycleRecoveryError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function dateOnly(value: unknown) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return null;
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function moneyOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.round(numeric * 100) / 100 : null;
}

function stringOrNull(value: unknown) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function recoveryMissingFields(agreement: any) {
  return [
    !agreement.agreement_start_date && "agreement_start_date",
    !agreement.agreement_end_date && "agreement_end_date",
    !agreement.agreement_duration_months && "agreement_duration_months",
  ].filter(Boolean) as string[];
}

function isLifecycleComplete(agreement: any) {
  return recoveryMissingFields(agreement).length === 0;
}

function snapshotValues(agreement: any) {
  const snapshot = (agreement?.content_snapshot || {}) as Record<string, any>;
  return {
    joining_date: snapshot.joining_date ?? snapshot.agreement_start_date ?? null,
    monthly_rent: snapshot.monthly_rent ?? null,
    advance_deposit: snapshot.security_deposit ?? snapshot.advance_deposit ?? null,
    maintenance_charge: snapshot.maintenance_charge ?? null,
    maintenance_type: snapshot.maintenance_type ?? null,
    payment_frequency: snapshot.payment_frequency ?? null,
  };
}

function resolveRecommendedStartDate(agreement: any) {
  const snapshot = snapshotValues(agreement);
  return dateOnly(snapshot.joining_date) || dateOnly(agreement.tenant?.joined_on) || dateOnly(agreement.generated_at);
}

function resolveContractFields(agreement: any) {
  const snapshot = snapshotValues(agreement);
  const contractRent = moneyOrNull(snapshot.monthly_rent);
  const contractSecurityDeposit = moneyOrNull(snapshot.advance_deposit);
  const contractMaintenance = moneyOrNull(snapshot.maintenance_charge);
  const contractMaintenanceType = stringOrNull(snapshot.maintenance_type);
  const contractPaymentFrequency = stringOrNull(snapshot.payment_frequency);

  const missing = [
    contractRent === null && "contract_rent",
    contractSecurityDeposit === null && "contract_security_deposit",
    contractMaintenance === null && "contract_maintenance",
    !contractMaintenanceType && "contract_maintenance_type",
    !contractPaymentFrequency && "contract_payment_frequency",
  ].filter(Boolean) as string[];

  return {
    fields: {
      contract_rent: contractRent,
      contract_security_deposit: contractSecurityDeposit,
      contract_maintenance: contractMaintenance,
      contract_maintenance_type: contractMaintenanceType,
      contract_payment_frequency: contractPaymentFrequency,
    },
    missing,
  };
}

function agreementPayload(agreement: any) {
  return {
    id: agreement.id,
    tenant: agreement.tenant
      ? {
          id: agreement.tenant.id,
          name: agreement.tenant.profiles?.name || null,
          joined_on: agreement.tenant.joined_on || null,
          room: agreement.tenant.room_allocations?.[0]?.room
            ? {
                id: agreement.tenant.room_allocations[0].room.id,
                room_no: agreement.tenant.room_allocations[0].room.room_no,
              }
            : null,
        }
      : null,
    hostel: agreement.hostel
      ? {
          id: agreement.hostel.id,
          name: agreement.hostel.name || null,
          owner_id: agreement.hostel.owner_id || null,
        }
      : null,
    current_status: agreement.status,
    status: agreement.status,
    agreement_start_date: agreement.agreement_start_date,
    agreement_end_date: agreement.agreement_end_date,
    agreement_duration_months: agreement.agreement_duration_months,
    snapshot_values: snapshotValues(agreement),
    recommended_start_date: resolveRecommendedStartDate(agreement),
    missing_fields: recoveryMissingFields(agreement),
    lifecycle_complete: isLifecycleComplete(agreement),
  };
}

function buildWhere(input: { ownerId?: string | null; hostelId?: string | null }) {
  return {
    status: agreementDocumentAccessibleWhere(),
    ...(input.hostelId ? { hostel_id: input.hostelId } : {}),
    ...(input.ownerId ? { hostel: { owner_id: input.ownerId } } : {}),
  };
}

export class AgreementLifecycleRecoveryService {
  constructor(private readonly db = prisma) {}

  async getRecoveryReport(input: { ownerId?: string | null; hostelId?: string | null } = {}) {
    const agreements = await this.db.agreement.findMany({
      where: buildWhere(input),
      include: {
        tenant: {
          select: {
            id: true,
            joined_on: true,
            profiles: { select: { name: true } },
            room_allocations: {
              where: { is_active: true, end_date: null },
              include: { room: { select: { id: true, room_no: true } } },
              take: 1,
            },
          },
        },
        hostel: { select: { id: true, name: true, owner_id: true } },
      },
      orderBy: [{ generated_at: "desc" }],
    });

    const rows = agreements.map(agreementPayload);
    const completed = rows.filter((row: any) => row.lifecycle_complete).length;
    const pending = rows.length - completed;

    return {
      total: rows.length,
      completed,
      pending,
      agreements: rows,
    };
  }

  async getRecoveryCompletion(input: { ownerId?: string | null; hostelId?: string | null } = {}) {
    const report = await this.getRecoveryReport(input);
    const coveragePercent = report.total > 0
      ? Math.round((report.completed / report.total) * 10_000) / 100
      : 0;

    return {
      total: report.total,
      completed: report.completed,
      pending: report.pending,
      coveragePercent,
      r4Ready: report.total > 0 && report.pending === 0 && coveragePercent === 100,
    };
  }

  async recoverAgreementLifecycle(agreementId: string, input: LifecycleRecoveryInput) {
    const startDate = dateOnly(input.agreement_start_date);
    const endDate = dateOnly(input.agreement_end_date);
    const durationMonths = Number(input.agreement_duration_months);

    if (!startDate) {
      throw new AgreementLifecycleRecoveryError("VALIDATION_ERROR", "agreement_start_date is required", 400, {
        field: "agreement_start_date",
      });
    }
    if (!endDate) {
      throw new AgreementLifecycleRecoveryError("VALIDATION_ERROR", "agreement_end_date is required", 400, {
        field: "agreement_end_date",
      });
    }
    if (!Number.isFinite(durationMonths) || Math.trunc(durationMonths) <= 0) {
      throw new AgreementLifecycleRecoveryError("VALIDATION_ERROR", "agreement_duration_months must be greater than 0", 400, {
        field: "agreement_duration_months",
      });
    }
    if (endDate <= startDate) {
      throw new AgreementLifecycleRecoveryError("VALIDATION_ERROR", "agreement_end_date must be after agreement_start_date", 400, {
        agreement_start_date: startDate,
        agreement_end_date: endDate,
      });
    }

    const agreement = await this.db.agreement.findUnique({
      where: { id: agreementId },
      include: {
        tenant: {
          select: {
            id: true,
            joined_on: true,
            profiles: { select: { name: true } },
            room_allocations: {
              where: { is_active: true, end_date: null },
              include: { room: { select: { id: true, room_no: true } } },
              take: 1,
            },
          },
        },
        hostel: { select: { id: true, name: true, owner_id: true } },
      },
    });

    if (!agreement) {
      throw new AgreementLifecycleRecoveryError("AGREEMENT_NOT_FOUND", "Agreement not found", 404, { agreementId });
    }
    if (!agreementDocumentAccessibleWhere().in.includes(agreement.status)) {
      throw new AgreementLifecycleRecoveryError("AGREEMENT_NOT_RECOVERABLE", "Agreement status is not recoverable", 409, {
        agreementId,
        status: agreement.status,
      });
    }

    const contract = resolveContractFields(agreement);
    if (contract.missing.length > 0) {
      throw new AgreementLifecycleRecoveryError(
        "CONTRACT_SNAPSHOT_INCOMPLETE",
        "Agreement content snapshot is missing contract values",
        409,
        { agreementId, missingFields: contract.missing }
      );
    }

    const updated = await this.db.agreement.update({
      where: { id: agreementId },
      data: {
        agreement_start_date: startDate,
        agreement_end_date: endDate,
        agreement_duration_months: Math.trunc(durationMonths),
        ...contract.fields,
      },
      include: {
        tenant: {
          select: {
            id: true,
            joined_on: true,
            profiles: { select: { name: true } },
            room_allocations: {
              where: { is_active: true, end_date: null },
              include: { room: { select: { id: true, room_no: true } } },
              take: 1,
            },
          },
        },
        hostel: { select: { id: true, name: true, owner_id: true } },
      },
    });

    return agreementPayload(updated);
  }
}

export const agreementLifecycleRecoveryService = new AgreementLifecycleRecoveryService();
