import { agreementRentScheduleService } from "../payments/agreement-rent-schedule-service";
import { evaluateActivationReadiness, type ReadinessFailure } from "./renewal-readiness-engine";
import { renewalTimelineService, type RenewalTimelineActorType } from "./renewal-timeline-service";

/**
 * Shared activation pipeline for both renewal activation paths:
 * AgreementLifecycleService.activateScheduledRenewals (cron, copies the
 * predecessor's signature forward) and AgreementRenewalSigningService
 * .signRenewalAgreement (manual, captures a fresh e-signature and
 * re-resolves the active template). Signature/rules-template resolution
 * genuinely differs between the two paths, so it stays the caller's
 * responsibility via buildSuccessorUpdateData — everything else (locking,
 * readiness, the predecessor/successor status transitions, tenant-contract
 * sync, rent-schedule generation) is identical and lives here.
 */

export class RenewalActivationBlockedError extends Error {
  failures: ReadinessFailure[];

  constructor(failures: ReadinessFailure[]) {
    super(failures[0]?.reason || "Renewal is not ready for activation");
    this.name = "RenewalActivationBlockedError";
    this.failures = failures;
  }
}

export class RenewalChainRaceError extends Error {
  target: "predecessor" | "successor";

  constructor(target: "predecessor" | "successor") {
    super(`Renewal chain changed during activation (${target})`);
    this.name = "RenewalChainRaceError";
    this.target = target;
  }
}

export type TenantContractSync = {
  monthly_rent: unknown;
  security_deposit: unknown;
  maintenance_charge: unknown;
  maintenance_type: unknown;
};

export type ActivateRenewalParams = {
  tx: any;
  predecessor: { id: string; status: string | null | undefined; renewed_to_agreement_id: string | null };
  successor: { id: string; tenant_id: string; hostel_id: string; [key: string]: any };
  now: Date;
  /**
   * Builds the successor's DRAFT->SIGNED update payload. Called only after
   * readiness passes and only once, right before the successor updateMany —
   * this is where signature capture / template-rules resolution happens,
   * since that's the one part of activation that's genuinely different
   * between cron and manual signing.
   */
  buildSuccessorUpdateData: () => Record<string, any>;
  /** Pass null to skip the tenants-table sync (should not normally happen — both activation paths sync it). */
  tenantContractSync: TenantContractSync | null;
  /** Who/what caused this activation — recorded on the RENEWAL_ACTIVATED timeline event. */
  timelineActor: { type: RenewalTimelineActorType; id?: string | null };
};

export async function activateRenewal(params: ActivateRenewalParams): Promise<void> {
  const { tx, predecessor, successor, now, buildSuccessorUpdateData, tenantContractSync, timelineActor } = params;

  // Lock both rows for the duration of the transaction so a concurrent
  // activation attempt (cron vs. manual sign, or two concurrent cron runs)
  // can't interleave with this one.
  await tx.$queryRaw`SELECT id FROM "Agreement" WHERE id = ${predecessor.id}::uuid FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "Agreement" WHERE id = ${successor.id}::uuid FOR UPDATE`;

  const readiness = await evaluateActivationReadiness(tx, { predecessor, successor });
  if (!readiness.ready) {
    throw new RenewalActivationBlockedError(readiness.failures);
  }

  const predecessorUpdate = await tx.agreement.updateMany({
    where: { id: predecessor.id, status: { in: ["SIGNED", "EXPIRING_SOON", "AGREEMENT_EXPIRED"] } },
    data: { status: "RENEWED", renewed_at: now },
  });
  if (predecessorUpdate.count !== 1) {
    throw new RenewalChainRaceError("predecessor");
  }

  const successorUpdate = await tx.agreement.updateMany({
    where: { id: successor.id, status: "DRAFT", renewed_from_agreement_id: predecessor.id },
    data: buildSuccessorUpdateData(),
  });
  if (successorUpdate.count !== 1) {
    throw new RenewalChainRaceError("successor");
  }

  if (tenantContractSync) {
    await tx.tenants.update({ where: { id: successor.tenant_id }, data: tenantContractSync });
  }

  await agreementRentScheduleService.generateForAgreementInTx(tx, successor.id);

  await renewalTimelineService.registerEvent(tx, {
    hostelId: successor.hostel_id,
    tenantId: successor.tenant_id,
    agreementId: successor.id,
    eventType: "RENEWAL_ACTIVATED",
    actorType: timelineActor.type,
    actorId: timelineActor.id ?? null,
  });
}
