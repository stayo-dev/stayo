import { prisma } from "@/lib/db";
import { randomUUID } from "crypto";
import {
  buildRenewalAgreementLifecycle,
  toAgreementDate,
  addAgreementMonths,
} from "./agreement-lifecycle-completeness";
import type { RenewalLifecycleInput } from "./agreement-lifecycle-completeness";
import { evaluateCreationReadiness } from "./renewal-readiness-engine";
import { renewalTimelineService } from "./renewal-timeline-service";

const RENEWABLE_AGREEMENT_STATUSES = ["SIGNED", "EXPIRING_SOON", "AGREEMENT_EXPIRED"] as const;
const BLOCKED_RENEWAL_STATUSES = ["RENEWED", "TERMINATED", "VOID"] as const;

type BlockedRenewalStatus = typeof BLOCKED_RENEWAL_STATUSES[number];

type AgreementRenewalErrorCode =
  | "AGREEMENT_NOT_FOUND"
  | "AGREEMENT_NOT_RENEWABLE"
  | "AGREEMENT_SUCCESSOR_EXISTS"
  | "MOVE_OUT_IN_PROGRESS"
  | "AGREEMENT_LIFECYCLE_INCOMPLETE";

type AgreementRenewalDraftResult = {
  sourceAgreement: any;
  renewalDraft: any;
};

function moneyOrNull(value: unknown) {
  if (value === null || value === undefined) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function toPositiveIntegerOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  const integer = Math.trunc(numeric);
  return integer > 0 ? integer : null;
}

function resolveSourceLifecycle(sourceAgreement: any) {
  const snapshot = (sourceAgreement?.content_snapshot || {}) as Record<string, any>;

  const startDate = toAgreementDate(sourceAgreement?.agreement_start_date)
    ?? toAgreementDate(snapshot.agreement_start_date)
    ?? toAgreementDate(snapshot.joining_date)
    ?? toAgreementDate(snapshot.billing_start_date);

  const durationMonths = toPositiveIntegerOrNull(sourceAgreement?.agreement_duration_months)
    ?? toPositiveIntegerOrNull(snapshot.agreement_duration_months)
    ?? toPositiveIntegerOrNull(snapshot.duration_months)
    ?? toPositiveIntegerOrNull(snapshot.duration);

  const endDate = toAgreementDate(sourceAgreement?.agreement_end_date)
    ?? toAgreementDate(snapshot.agreement_end_date)
    ?? (startDate && durationMonths ? addAgreementMonths(startDate, durationMonths) : null);

  return {
    startDate,
    endDate,
    durationMonths,
  };
}

function resolveContractSnapshot(sourceAgreement: any) {
  const snapshot = (sourceAgreement?.content_snapshot || {}) as Record<string, any>;
  const contractRent = moneyOrNull(sourceAgreement?.contract_rent) ?? moneyOrNull(snapshot.monthly_rent);
  const contractDeposit = moneyOrNull(sourceAgreement?.contract_security_deposit) ?? moneyOrNull(snapshot.security_deposit ?? snapshot.advance_deposit);
  const contractMaintenance = moneyOrNull(sourceAgreement?.contract_maintenance) ?? moneyOrNull(snapshot.maintenance_charge);
  const contractMaintenanceType = sourceAgreement?.contract_maintenance_type ?? snapshot.maintenance_type ?? null;
  const contractPaymentFrequency = sourceAgreement?.contract_payment_frequency ?? snapshot.payment_frequency ?? null;

  return {
    contentSnapshot: {
      ...snapshot,
      ...(contractRent !== null ? { monthly_rent: contractRent } : {}),
      ...(contractDeposit !== null ? { security_deposit: contractDeposit, advance_deposit: contractDeposit } : {}),
      ...(contractMaintenance !== null ? { maintenance_charge: contractMaintenance } : {}),
      ...(contractMaintenanceType ? { maintenance_type: contractMaintenanceType } : {}),
      ...(contractPaymentFrequency ? { payment_frequency: contractPaymentFrequency } : {}),
      renewed_from_agreement_id: sourceAgreement.id,
      previous_agreement_version: sourceAgreement.agreement_version || 1,
    },
    contractRent,
    contractDeposit,
    contractMaintenance,
    contractMaintenanceType,
    contractPaymentFrequency,
  };
}

export class AgreementRenewalError extends Error {
  code: AgreementRenewalErrorCode;
  status = 409;
  details?: Record<string, unknown>;

  constructor(code: AgreementRenewalErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "AgreementRenewalError";
    this.code = code;
    this.details = details;
  }
}

export class AgreementRenewalService {
  constructor(private readonly db = prisma) {}

  async createRenewalDraft(
    sourceAgreementId: string,
    lifecycleInput: RenewalLifecycleInput = {}
  ): Promise<AgreementRenewalDraftResult> {
    return this.db.$transaction(async (tx: any) => {
      await tx.$queryRaw`SELECT id FROM "Agreement" WHERE id = ${sourceAgreementId}::uuid FOR UPDATE`;

      const sourceAgreement = await tx.agreement.findUnique({
        where: { id: sourceAgreementId },
        include: {
          tenant: {
            select: {
              id: true,
              status: true,
              owner_id: true,
              hostel_id: true,
            },
          },
          renewed_to_agreement: true,
          renewed_agreements: {
            where: { status: { notIn: ["VOID", "TERMINATED"] } },
            orderBy: { generated_at: "desc" },
            take: 1,
          },
        },
      });

      if (!sourceAgreement) {
        throw new AgreementRenewalError("AGREEMENT_NOT_FOUND", "Agreement not found", { sourceAgreementId });
      }

      const contract = resolveContractSnapshot(sourceAgreement);
      const sourceLifecycle = resolveSourceLifecycle(sourceAgreement);

      const defaultStartDate = lifecycleInput.agreement_start_date
        ? toAgreementDate(lifecycleInput.agreement_start_date)
        : sourceLifecycle.endDate;

      const defaultDuration = toPositiveIntegerOrNull(lifecycleInput.agreement_duration_months)
        ?? sourceLifecycle.durationMonths;

      const defaultEndDate = lifecycleInput.agreement_end_date
        ? toAgreementDate(lifecycleInput.agreement_end_date)
        : (defaultStartDate && defaultDuration ? addAgreementMonths(defaultStartDate, defaultDuration) : null);

      const lifecycle = {
        agreement_start_date: defaultStartDate,
        agreement_end_date: defaultEndDate,
        agreement_duration_months: defaultDuration,
      };

      const nextVersion = Number(sourceAgreement.agreement_version || 1) + 1;
      const renewalLifecycleCandidate = {
        ...lifecycle,
        contract_rent: contract.contractRent,
        contract_security_deposit: contract.contractDeposit,
        contract_maintenance: contract.contractMaintenance,
        contract_maintenance_type: contract.contractMaintenanceType,
        contract_payment_frequency: contract.contractPaymentFrequency,
      };

      const readiness = await evaluateCreationReadiness(tx, {
        sourceAgreement,
        lifecycleCandidate: renewalLifecycleCandidate,
      });
      if (!readiness.ready) {
        const failure = readiness.failures[0];
        if (failure.code === "PREDECESSOR_NOT_RENEWABLE") {
          this.assertRenewableStatus(sourceAgreement.status, sourceAgreement.id);
        }
        if (failure.code === "AGREEMENT_SUCCESSOR_EXISTS") {
          throw new AgreementRenewalError("AGREEMENT_SUCCESSOR_EXISTS", failure.reason, {
            sourceAgreementId: sourceAgreement.id,
            ...failure.details,
          });
        }
        if (failure.code === "MOVE_OUT_IN_PROGRESS") {
          throw new AgreementRenewalError(
            "MOVE_OUT_IN_PROGRESS",
            "Move-out already in progress. Cancel move-out before renewing.",
            { sourceAgreementId: sourceAgreement.id, ...failure.details }
          );
        }
        // AGREEMENT_LIFECYCLE_INCOMPLETE
        throw new AgreementRenewalError("AGREEMENT_LIFECYCLE_INCOMPLETE", failure.reason, failure.details);
      }

      const activeTemplate = await tx.agreementTemplate.findFirst({
        where: {
          hostel_id: sourceAgreement.hostel_id,
          type: "RESIDENCY",
          status: "PUBLISHED",
          is_active: true,
        },
      });
      const templateId = activeTemplate?.id || sourceAgreement.template_id;

      const renewalDraft = await tx.agreement.create({
        data: {
          id: randomUUID(),
          tenant_id: sourceAgreement.tenant_id,
          hostel_id: sourceAgreement.hostel_id,
          template_id: templateId,
          renewed_from_agreement_id: sourceAgreement.id,
          status: "DRAFT",
          agreement_version: nextVersion,
          agreement_start_date: lifecycle.agreement_start_date,
          agreement_end_date: lifecycle.agreement_end_date,
          agreement_duration_months: lifecycle.agreement_duration_months,
          contract_rent: contract.contractRent,
          contract_security_deposit: contract.contractDeposit,
          contract_maintenance: contract.contractMaintenance,
          contract_maintenance_type: contract.contractMaintenanceType,
          contract_payment_frequency: contract.contractPaymentFrequency,
          content_snapshot: {
            ...contract.contentSnapshot,
            agreement_start_date: lifecycle.agreement_start_date?.toISOString().slice(0, 10),
            agreement_end_date: lifecycle.agreement_end_date?.toISOString().slice(0, 10),
            agreement_duration_months: lifecycle.agreement_duration_months,
          },
        },
      });

      const sourceUpdate = await tx.agreement.updateMany({
        where: {
          id: sourceAgreement.id,
          renewed_to_agreement_id: null,
        },
        data: {
          renewed_to_agreement_id: renewalDraft.id,
        },
      });

      if (sourceUpdate.count !== 1) {
        throw new AgreementRenewalError(
          "AGREEMENT_SUCCESSOR_EXISTS",
          "A renewal agreement already exists for this agreement",
          { sourceAgreementId: sourceAgreement.id }
        );
      }

      await renewalTimelineService.registerEvent(tx, {
        hostelId: sourceAgreement.hostel_id,
        tenantId: sourceAgreement.tenant_id,
        agreementId: renewalDraft.id,
        eventType: "DRAFT_CREATED",
        actorType: "SYSTEM",
      });

      return {
        sourceAgreement: {
          ...sourceAgreement,
          renewed_to_agreement_id: renewalDraft.id,
        },
        renewalDraft,
      };
    });
  }

  private assertRenewableStatus(status: string, agreementId: string) {
    if ((RENEWABLE_AGREEMENT_STATUSES as readonly string[]).includes(status)) return;

    const blocked = (BLOCKED_RENEWAL_STATUSES as readonly string[]).includes(status);
    const message = blocked
      ? `Agreement status ${status as BlockedRenewalStatus} cannot be renewed`
      : `Agreement status ${status} is not eligible for renewal`;

    throw new AgreementRenewalError("AGREEMENT_NOT_RENEWABLE", message, {
      agreementId,
      status,
      allowedStatuses: [...RENEWABLE_AGREEMENT_STATUSES],
    });
  }
}

export const agreementRenewalService = new AgreementRenewalService();

export async function createAgreementRenewalDraft(sourceAgreementId: string, lifecycleInput: RenewalLifecycleInput) {
  return agreementRenewalService.createRenewalDraft(sourceAgreementId, lifecycleInput);
}
