import { isCurrentAgreementStatus } from "./agreement-status";
import { assertAgreementLifecycleComplete } from "./agreement-lifecycle-completeness";

/**
 * Shared validation logic for every place that can activate or create a
 * renewal: AgreementLifecycleService.activateScheduledRenewals (cron),
 * AgreementRenewalSigningService.signRenewalAgreement (manual signing), and
 * AgreementRenewalService.createRenewalDraft (manual draft creation).
 *
 * Each check function is pure (or a single read query) and returns a
 * structured failure or null — callers compose them via the orchestrators
 * below, or call individual checks directly if their error-shaping needs
 * differ from the canonical orchestrators.
 */

export type ReadinessFailureCode =
  | "PREDECESSOR_NOT_RENEWABLE"
  | "INVALID_RENEWAL_CHAIN"
  | "MOVE_OUT_IN_PROGRESS"
  | "AGREEMENT_LIFECYCLE_INCOMPLETE"
  | "SECURITY_DEPOSIT_UNPAID"
  | "AGREEMENT_SUCCESSOR_EXISTS";

export type ReadinessFailure = {
  code: ReadinessFailureCode;
  reason: string;
  details: Record<string, unknown>;
};

export type ReadinessResult = {
  ready: boolean;
  failures: ReadinessFailure[];
};

function toResult(failures: ReadinessFailure[]): ReadinessResult {
  return { ready: failures.length === 0, failures };
}

// ─── Individual checks ───────────────────────────────────────────────────

export function checkPredecessorRenewable(predecessor: {
  id: string;
  status: string | null | undefined;
}): ReadinessFailure | null {
  if (isCurrentAgreementStatus(predecessor.status)) return null;
  return {
    code: "PREDECESSOR_NOT_RENEWABLE",
    reason: "Predecessor agreement is not in a renewable status",
    details: { predecessorAgreementId: predecessor.id, predecessorStatus: predecessor.status },
  };
}

export function checkChainConsistent(
  predecessor: { id: string; renewed_to_agreement_id: string | null },
  successorId: string
): ReadinessFailure | null {
  if (predecessor.renewed_to_agreement_id === successorId) return null;
  return {
    code: "INVALID_RENEWAL_CHAIN",
    reason: "Renewal chain is invalid",
    details: {
      predecessorAgreementId: predecessor.id,
      predecessorRenewedToAgreementId: predecessor.renewed_to_agreement_id,
      successorAgreementId: successorId,
    },
  };
}

export async function checkNoActiveMoveOut(tx: any, tenantId: string): Promise<ReadinessFailure | null> {
  const activeMoveOut = await tx.move_out_requests.findFirst({
    where: { tenant_id: tenantId, status: { notIn: ["COMPLETED", "REJECTED"] } },
    select: { id: true, status: true },
    orderBy: { created_at: "desc" },
  });
  if (!activeMoveOut) return null;
  return {
    code: "MOVE_OUT_IN_PROGRESS",
    reason: "Move-out already in progress",
    details: { tenantId, moveOutRequestId: activeMoveOut.id, moveOutStatus: activeMoveOut.status },
  };
}

export function checkLifecycleComplete(
  agreementOrCandidate: Record<string, any>,
  agreementId: string
): ReadinessFailure | null {
  try {
    assertAgreementLifecycleComplete(agreementOrCandidate, { agreementId });
    return null;
  } catch (error: any) {
    return {
      code: "AGREEMENT_LIFECYCLE_INCOMPLETE",
      reason: error?.message || "Agreement lifecycle metadata is incomplete",
      details: error?.details || { agreementId },
    };
  }
}

export async function checkNoUnpaidDeposit(tx: any, successorAgreementId: string): Promise<ReadinessFailure | null> {
  const unpaidDeposit = await tx.rent_obligations.findFirst({
    where: {
      agreement_id: successorAgreementId,
      obligation_type: "SECURITY_DEPOSIT",
      status: { in: ["PENDING", "PARTIAL"] },
      is_superseded: false,
    },
  });
  if (!unpaidDeposit) return null;
  return {
    code: "SECURITY_DEPOSIT_UNPAID",
    reason: "Unpaid security deposit top-up obligation",
    details: {
      agreementId: successorAgreementId,
      obligationId: unpaidDeposit.id,
      amount: Number(unpaidDeposit.amount),
    },
  };
}

export function checkNoExistingSuccessor(sourceAgreement: {
  id: string;
  renewed_to_agreement?: { id: string; status: string } | null;
  renewed_agreements?: { id: string; status: string }[];
}): ReadinessFailure | null {
  const existingSuccessor = sourceAgreement.renewed_to_agreement || sourceAgreement.renewed_agreements?.[0] || null;
  if (!existingSuccessor) return null;
  return {
    code: "AGREEMENT_SUCCESSOR_EXISTS",
    reason: "A renewal agreement already exists for this agreement",
    details: {
      sourceAgreementId: sourceAgreement.id,
      successorAgreementId: existingSuccessor.id,
      successorStatus: existingSuccessor.status,
    },
  };
}

// ─── Orchestrators ───────────────────────────────────────────────────────

/**
 * Canonical check set + order for activating a renewal draft into SIGNED
 * (cron auto-activation and manual signing both use this): renewable,
 * chain-consistent, lifecycle-complete, no active move-out, no unpaid
 * deposit. Must run inside a transaction where the predecessor and
 * successor rows are already locked (FOR UPDATE) by the caller.
 */
export async function evaluateActivationReadiness(
  tx: any,
  params: {
    predecessor: { id: string; status: string | null | undefined; renewed_to_agreement_id: string | null };
    successor: { id: string; tenant_id: string; [key: string]: any };
  }
): Promise<ReadinessResult> {
  const failures: ReadinessFailure[] = [];

  const predecessorRenewable = checkPredecessorRenewable(params.predecessor);
  if (predecessorRenewable) failures.push(predecessorRenewable);

  const chainConsistent = checkChainConsistent(params.predecessor, params.successor.id);
  if (chainConsistent) failures.push(chainConsistent);

  const lifecycleComplete = checkLifecycleComplete(params.successor, params.successor.id);
  if (lifecycleComplete) failures.push(lifecycleComplete);

  const noActiveMoveOut = await checkNoActiveMoveOut(tx, params.successor.tenant_id);
  if (noActiveMoveOut) failures.push(noActiveMoveOut);

  const noUnpaidDeposit = await checkNoUnpaidDeposit(tx, params.successor.id);
  if (noUnpaidDeposit) failures.push(noUnpaidDeposit);

  return toResult(failures);
}

/**
 * Canonical check set + order for creating a renewal draft (before any
 * successor or deposit obligation exists): renewable, no existing
 * successor, no active move-out, lifecycle-complete on the proposed terms.
 */
export async function evaluateCreationReadiness(
  tx: any,
  params: {
    sourceAgreement: {
      id: string;
      status: string | null | undefined;
      renewed_to_agreement?: { id: string; status: string } | null;
      renewed_agreements?: { id: string; status: string }[];
      tenant_id: string;
    };
    lifecycleCandidate: Record<string, any>;
  }
): Promise<ReadinessResult> {
  const failures: ReadinessFailure[] = [];

  const predecessorRenewable = checkPredecessorRenewable(params.sourceAgreement);
  if (predecessorRenewable) failures.push(predecessorRenewable);

  const noExistingSuccessor = checkNoExistingSuccessor(params.sourceAgreement);
  if (noExistingSuccessor) failures.push(noExistingSuccessor);

  const noActiveMoveOut = await checkNoActiveMoveOut(tx, params.sourceAgreement.tenant_id);
  if (noActiveMoveOut) failures.push(noActiveMoveOut);

  const lifecycleComplete = checkLifecycleComplete(params.lifecycleCandidate, params.sourceAgreement.id);
  if (lifecycleComplete) failures.push(lifecycleComplete);

  return toResult(failures);
}
