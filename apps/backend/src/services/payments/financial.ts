/**
 * 🏛️ Financial Architecture v2 — Barrel Export
 *
 * Single import point for the entire financial domain.
 *
 * Usage:
 *   import { executePlanInTx, financialTimelineService, ... } from "./financial";
 */

// ── Domain Types ─────────────────────────────────────────────────────────────
export type {
  LifecycleStatus,
  SettlementStatus,
  PresentationStatus,
  FinancialObligation,
  FinancialContext,
} from "./financial-obligation.types";

export {
  derivePresentationStatus,
  toLegacyStatus,
  fromLegacyStatus,
  isPayableObligation,
  isTerminalLifecycle,
  LIFECYCLE_STATUSES,
  SETTLEMENT_STATUSES,
} from "./financial-obligation.types";

// ── Financial Policy ─────────────────────────────────────────────────────────
export type { FinancialPolicy } from "./financial-policy";
export { extractFinancialPolicy, toPaymentPolicy } from "./financial-policy";
export { FinancialPolicyEngine, financialPolicyEngine } from "./financial-policy-engine";

// ── Settlement Engine ────────────────────────────────────────────────────────
export type {
  ExecutablePlan,
  ExecutionInput,
  SettlementResult,
  SettlementBreakdown,
  SettlementAllocationResult,
} from "./settlement-engine";
export { executePlanInTx } from "./settlement-engine";

// ── Financial Payment Facade ─────────────────────────────────────────────────
export type {
  ReceivePaymentInput,
  ReceivePaymentResult,
  PreviewSettlementInput,
} from "./financial-payment-facade";
export { FinancialPaymentFacade, financialPaymentFacade } from "./financial-payment-facade";

// ── Financial Correction Gateway ─────────────────────────────────────────────
export type {
  CorrectionType,
  CorrectionInput,
  CorrectionResult,
  IFinancialCorrectionGateway,
} from "./financial-correction-gateway";
export { financialCorrectionGateway } from "./financial-correction-gateway";

// ── Financial Timeline / Activity Feed ───────────────────────────────────────
// financialActivityFeed is an alias for financialTimelineService — same
// strictly-read-only projection over payments, obligations, ledger,
// payment_groups, and change_requests. Not a rename, to avoid touching the
// existing history/route.ts import of financialTimelineService.
export type {
  TimelineEvent,
  TimelineEventType,
} from "./financial-timeline-service";
export { financialTimelineService, financialTimelineService as financialActivityFeed } from "./financial-timeline-service";
