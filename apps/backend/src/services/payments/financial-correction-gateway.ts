/**
 * 🔧 Financial Correction Gateway
 *
 * Abstraction layer between the Obligation Engine and the Ledger.
 *
 * The Obligation Engine changes obligation state.
 * The Gateway handles the financial consequences.
 *
 * Today:  Gateway → Ledger (direct)
 * Later:  Gateway → Domain Events → FinancialCorrectionService → Ledger
 *
 * This gives us the architectural seam without forcing the full
 * event-driven correction framework right now.
 *
 * Supported correction types:
 *   - WAIVER: Write off outstanding balance
 *   - CANCELLATION: Void an unpaid obligation
 *   - ADJUSTMENT: Change obligation amount (future)
 *   - REALLOCATION: Move payment between obligations (future)
 *   - REFUND: Return money to tenant (future)
 */

import { tenantFinancialLedgerService } from "./tenant-financial-ledger-service";
import { getLogger } from "@/lib/logger";

const logger = getLogger("financial-correction-gateway");

// ── Correction Types ─────────────────────────────────────────────────────────

export type CorrectionType =
  | "WAIVER"
  | "CANCELLATION"
  | "ADJUSTMENT"
  | "REALLOCATION"
  | "REFUND";

export interface CorrectionInput {
  type: CorrectionType;
  obligationId: string;
  tenantId: string;
  ownerId: string;
  actorId: string;
  amount: number;
  reason: string;
  displayLabel: string;
  metadata?: Record<string, any>;
}

export interface CorrectionResult {
  success: boolean;
  correction_type: CorrectionType;
  ledger_entry_id?: string;
  error?: string;
}

// ── Gateway Interface ────────────────────────────────────────────────────────

export interface IFinancialCorrectionGateway {
  applyCorrection(tx: any, input: CorrectionInput): Promise<CorrectionResult>;
}

// ── Direct Implementation ────────────────────────────────────────────────────
// Today's simple implementation: direct ledger calls.
// Tomorrow: swap this for an event-driven implementation.

class DirectLedgerCorrectionGateway implements IFinancialCorrectionGateway {
  async applyCorrection(tx: any, input: CorrectionInput): Promise<CorrectionResult> {
    const { type, obligationId, tenantId, ownerId, actorId, amount, reason, displayLabel } = input;

    try {
      switch (type) {
        case "WAIVER": {
          await tenantFinancialLedgerService.debitInTx(tx, {
            tenantId,
            ownerId: actorId,
            createdBy: actorId,
            reason: "OBLIGATION_WAIVER",
            amount,
            notes: `Waived outstanding balance of ₹${amount.toLocaleString("en-IN")} on ${displayLabel}. Reason: ${reason}`,
            referenceId: obligationId,
            referenceType: "RENT_OBLIGATION_WAIVER",
          });

          logger.info("correction.waiver.applied", {
            obligation_id: obligationId,
            tenant_id: tenantId,
            amount,
            actor_id: actorId,
          });

          return { success: true, correction_type: "WAIVER" };
        }

        case "CANCELLATION": {
          // Cancellation of unpaid obligations doesn't require a ledger entry
          // because no money was ever owed in the ledger's view.
          // The obligation status change IS the correction.
          logger.info("correction.cancellation.applied", {
            obligation_id: obligationId,
            tenant_id: tenantId,
            amount,
            actor_id: actorId,
          });

          return { success: true, correction_type: "CANCELLATION" };
        }

        case "ADJUSTMENT":
        case "REALLOCATION":
        case "REFUND": {
          // Future correction types — not yet implemented
          return {
            success: false,
            correction_type: type,
            error: `Correction type '${type}' is not yet implemented. Use the Financial Corrections framework when available.`,
          };
        }

        default:
          return {
            success: false,
            correction_type: type,
            error: `Unknown correction type: ${type}`,
          };
      }
    } catch (err: any) {
      logger.error("correction.failed", {
        type,
        obligation_id: obligationId,
        error: String(err),
      });
      throw err; // Re-throw — corrections are transactional, must not silently fail
    }
  }
}

// ── Singleton ────────────────────────────────────────────────────────────────

export const financialCorrectionGateway: IFinancialCorrectionGateway =
  new DirectLedgerCorrectionGateway();
