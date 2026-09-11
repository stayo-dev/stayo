/**
 * Renewal + reactivation of an owner subscription (ADR-172, Phase 3).
 *
 * A renewal rolls the paid period forward without overlap:
 *   - ACTIVE + still-live period → next period starts at the old period's END
 *     (a late payment does not shift the billing date)
 *   - PAUSED / PENDING_PAYMENT / EXPIRED, or an ACTIVE period already over →
 *     next period starts TODAY and the subscription becomes ACTIVE
 *
 * A queued downgrade (`pending_plan_id`, set in Phase 2) is applied HERE, at the
 * renewal — the new period runs on the pending plan at its full price, and
 * `pending_plan_id` is cleared. Before the renewal the current plan and its
 * capacity are unchanged.
 *
 * `computeRenewal` is pure; `applyApprovedRenewal` executes it inside a caller's
 * transaction.
 */
import {
  computeBillingPeriod,
  toDateOnly,
  type BillingPeriod,
  type SubscriptionStatus,
} from "./subscription-rules";

export type RenewalOutcome = {
  status: "ACTIVE";
  effective_plan_id: string;
  cleared_pending: boolean;
  period: BillingPeriod;
  /** The new period's plan full price — the invoice amount for a NEW/RENEWAL. */
  full_price_paise: number;
};

export function computeRenewal(params: {
  now: Date;
  currentStatus: SubscriptionStatus;
  currentPeriodEnd: Date | null;
  pendingPlanId: string | null;
  pendingPlanPricePaise: number | null;
  paymentPlanId: string;
  paymentPlanPricePaise: number;
}): RenewalOutcome {
  const today = toDateOnly(params.now);

  const stillLive =
    params.currentStatus === "ACTIVE" &&
    params.currentPeriodEnd != null &&
    toDateOnly(params.currentPeriodEnd).getTime() > today.getTime();

  const anchor = stillLive ? toDateOnly(params.currentPeriodEnd as Date) : today;
  const period = computeBillingPeriod(anchor);

  const usePending = params.pendingPlanId != null;
  const effectivePlanId = usePending ? (params.pendingPlanId as string) : params.paymentPlanId;
  const fullPrice = usePending
    ? params.pendingPlanPricePaise ?? params.paymentPlanPricePaise
    : params.paymentPlanPricePaise;

  return {
    status: "ACTIVE",
    effective_plan_id: effectivePlanId,
    cleared_pending: usePending,
    period,
    full_price_paise: fullPrice,
  };
}

/** The `owner_subscriptions.update` data a renewal produces. */
export function renewalUpdateData(outcome: RenewalOutcome, params: { now: Date; startedAt: Date | null }) {
  return {
    status: outcome.status,
    plan_id: outcome.effective_plan_id,
    pending_plan_id: null,
    started_at: params.startedAt ?? params.now,
    current_period_start: outcome.period.start,
    current_period_end: outcome.period.end,
    next_renewal_at: outcome.period.nextRenewal,
    trial_ends_at: null,
    admin_override_until: null, // a paid renewal supersedes any hold
    updated_at: params.now,
  };
}
