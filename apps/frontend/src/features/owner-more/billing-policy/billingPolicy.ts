/**
 * Owner-facing language for the hostel's billing policy.
 *
 * Two rules govern everything here (ADR-043):
 *
 * 1. **Never surface a backend flag.** The owner never sees
 *    `allow_partial_payments`, `minimum_amount` or `payment_policy`. They see
 *    "Full payment only" and "₹7,900 will stay outstanding".
 * 2. **Say what will happen, before it happens.** The collect flow previously
 *    let the owner type an amount, walk to the review step, and only then be
 *    told the payment was impossible — while simultaneously rendering a
 *    success preview. These helpers exist so the policy can be stated up front
 *    and the review step can describe the real outcome.
 *
 * Pure — no React, no network — so the wording is testable.
 */

export type PaymentPolicyMode = 'FULL_PAYMENT' | 'PARTIAL_ALLOWED';

export interface PartialPaymentPolicy {
  enabled: boolean;
  /** Absolute floor in rupees. 0 = none. */
  minimumAmount: number;
  /** Percentage (0-100) of outstanding. 0 = none. */
  minimumPercentage: number;
}

export const DEFAULT_PARTIAL_POLICY: PartialPaymentPolicy = {
  enabled: false,
  minimumAmount: 0,
  minimumPercentage: 0,
};

export function readPartialPolicy(policy: any): PartialPaymentPolicy {
  const p = policy?.billing?.partial_payments;
  if (!p) return DEFAULT_PARTIAL_POLICY;
  return {
    enabled: Boolean(p.enabled),
    minimumAmount: Number(p.minimum_amount ?? 0) || 0,
    minimumPercentage: Number(p.minimum_percentage ?? 0) || 0,
  };
}

export function formatINR(value: number): string {
  return `₹${Math.round(value).toLocaleString('en-IN')}`;
}

/** Short label for the policy chip shown before the owner types an amount. */
export function policyHeadline(policy: PartialPaymentPolicy): string {
  return policy.enabled ? 'Part payments allowed' : 'Full payment only';
}

/**
 * One sentence under the headline explaining the practical consequence.
 * Deliberately concrete about the floor, because the floor is the thing that
 * will otherwise block them at the review step.
 */
export function policyDetail(policy: PartialPaymentPolicy): string {
  if (!policy.enabled) {
    return 'Each due must be cleared in full. Smaller amounts will be declined.';
  }
  const floors: string[] = [];
  if (policy.minimumPercentage > 0) floors.push(`${policy.minimumPercentage}% of what's owed`);
  if (policy.minimumAmount > 0) floors.push(formatINR(policy.minimumAmount));

  if (floors.length === 0) return 'You can collect any amount towards what this tenant owes.';
  if (floors.length === 1) return `You can collect any amount from ${floors[0]} upwards.`;
  return `You can collect any amount from ${floors[0]} or ${floors[1]} upwards, whichever is higher.`;
}

/**
 * What the owner will see after confirming, in plain language.
 * Returns an ordered list of statements — the caller renders them as bullets.
 *
 * `collected` is what's being paid now; `remaining` is what will still be owed.
 */
export function outcomeStatements(input: {
  collected: number;
  remaining: number;
  clearedCount: number;
  partialCount: number;
}): string[] {
  const { collected, remaining, clearedCount, partialCount } = input;
  const out: string[] = [`${formatINR(collected)} will be collected.`];

  if (clearedCount > 0) {
    out.push(`${clearedCount} due${clearedCount > 1 ? 's' : ''} will be fully cleared.`);
  }
  if (remaining > 0) {
    out.push(`${formatINR(remaining)} will remain outstanding.`);
    out.push(
      partialCount > 0
        ? 'This tenant will keep showing as partly unpaid until the rest is collected.'
        : 'This tenant will keep showing as unpaid until the rest is collected.',
    );
  } else {
    out.push('This tenant will have nothing outstanding.');
  }

  out.push('A receipt is generated and the tenant is notified.');
  return out;
}

/**
 * Why a payment can't go through, in owner language, plus what to do about it.
 *
 * The backend already returns an owner-readable `rejection_reason`; this adds
 * the *action*, which is the part that was missing — previously the owner was
 * told "no" with nowhere to go.
 */
export function blockedExplanation(input: {
  policy: PartialPaymentPolicy;
  minimumAllowed: number;
  entered: number;
}): { title: string; body: string; canFixInSettings: boolean } {
  const { policy, minimumAllowed, entered } = input;

  if (!policy.enabled) {
    return {
      title: 'This hostel takes full payments only',
      body: `${formatINR(entered)} isn't enough to clear the next due of ${formatINR(
        minimumAllowed,
      )}. Either collect the full amount, or allow part payments in your billing policy.`,
      canFixInSettings: true,
    };
  }

  const reason =
    policy.minimumPercentage > 0 && minimumAllowed > policy.minimumAmount
      ? `your policy asks for at least ${policy.minimumPercentage}% of what's owed`
      : 'your policy sets a minimum part payment';

  return {
    title: 'Below your minimum part payment',
    body: `${formatINR(entered)} is under ${formatINR(
      minimumAllowed,
    )}, because ${reason}. Collect ${formatINR(minimumAllowed)} or more, or lower the minimum in your billing policy.`,
    canFixInSettings: true,
  };
}

/** Canonical route for the one screen that edits billing behaviour. */
export const BILLING_POLICY_PATH = '/owner/more/configuration/finance/billing-policy';
