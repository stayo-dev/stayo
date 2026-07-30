/**
 * 🔄 Financial Lifecycle Service
 *
 * The single, sole business orchestrator for "an obligation just became
 * payable." Coordinates ObligationEngine (domain-only status transition)
 * and FinancialPaymentFacade (credit sweep via the existing Settlement
 * Planner → Settlement Engine), plus lifecycle notifications.
 *
 * Contains NO settlement logic and NO ledger logic of its own — it only
 * calls the two engines and composes their results. Every code path that
 * can make an obligation payable (agreement schedules, monthly rent
 * generation, syncDueStatuses, onboarding, manual admin creation, late-fee
 * generation, renewal-offer deposit obligations) routes through
 * activatePayableObligations — there is no parallel/competing activation
 * path anywhere else in the codebase.
 */

import { getLogger } from "@/lib/logger";
import { eventSystem } from "@/lib/events";
import { obligationEngine } from "./obligation-engine";
import { financialPaymentFacade } from "./financial-payment-facade";

const logger = getLogger("financial-lifecycle-service");

export interface ActivatePayableObligationsParams {
  tenantId: string;
  ownerId: string;
  hostelId: string;
  obligationIds: string[];
}

export interface ObligationActivationResult {
  id: string;
  previousStatus: string;
  newStatus: string;
}

export class FinancialLifecycleService {
  /**
   * Thin orchestrator: mark obligations payable (ObligationEngine), then
   * sweep any available future-rent credit across ALL the tenant's
   * outstanding obligations (FinancialPaymentFacade), broad-sweep mode (no
   * obligationIdFilter) so priority order applies across the full set, not
   * just the newly-activated ones. Must be called INSIDE an existing
   * transaction.
   */
  async activatePayableObligations(
    tx: any,
    params: ActivatePayableObligationsParams
  ): Promise<ObligationActivationResult[]> {
    const { tenantId, ownerId, hostelId, obligationIds } = params;

    const transitions = await obligationEngine.markObligationsPayableInTx(tx, { obligationIds });

    await financialPaymentFacade.applyAvailableCredits(tx, {
      tenantId,
      ownerId,
      hostelId,
      actorId: ownerId,
    });

    return transitions;
  }

  /**
   * Post-commit lifecycle notification (cache invalidation + SSE broadcast —
   * the side effects of HMSEventEmitter.trigger(), keyed off owner_id /
   * hostel_id, not specific to any one event name). Callers invoke this
   * AFTER their own transaction commits, exactly where they previously fired
   * eventSystem.trigger("obligation_created", ...) directly — same event
   * name, same payload shape, same fire-and-forget timing. Routing it
   * through here just centralizes ownership of the notification
   * responsibility in this service.
   *
   * Reuses the "obligation_created" event name deliberately rather than
   * introducing a new one — HMSEventEmitter.trigger() performs cache
   * invalidation and SSE broadcast for this event unconditionally, whether
   * or not any `.on("obligation_created", ...)` listener is registered, so
   * the notification behavior is fully preserved even with the old
   * credit-sweep listener removed.
   */
  notifyActivated(params: { tenantId: string; ownerId: string; hostelId: string; source: string }): void {
    eventSystem
      .trigger("obligation_created", {
        tenant_id: params.tenantId,
        owner_id: params.ownerId,
        hostel_id: params.hostelId,
        source: params.source,
      })
      .catch((err: any) => {
        logger.error("financial-lifecycle.notify_failed", { ...params, error: String(err?.message || err) });
      });
  }
}

export const financialLifecycleService = new FinancialLifecycleService();
