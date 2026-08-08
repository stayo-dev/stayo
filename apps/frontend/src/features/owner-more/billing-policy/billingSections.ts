/**
 * The billing policy, split into sections an owner can edit one at a time.
 *
 * **Why this exists.** ADR-043 consolidated three overlapping billing screens
 * into one, because they each owned a slice of `billing` and overwrote each
 * other — the old `MoreBillingPage` silently rewrote a PERCENTAGE/PER_DAY late
 * fee to FLAT and dropped its cap by writing a partial late-fee shape. But one
 * screen holding five sections meant every Finance row deep-linked to the same
 * long form: tapping "Security deposit" landed you in a page where deposit was
 * one block of six.
 *
 * This gets both: focused screens **and** no cross-clobbering. `buildBillingPatch`
 * emits only the fields the visible sections own, and the backend deep-merges,
 * so an omitted section is left exactly as it was. The late fee is always
 * written whole — that specific partial write is the bug ADR-043 fixed.
 *
 * Pure and I/O-free, so the isolation property is testable.
 */

import type { DepositMode } from './depositPolicy';

export type BillingSectionKey = 'collection' | 'deposit' | 'agreement' | 'schedule' | 'lateFee';

export type ChargeType = 'FLAT' | 'PERCENTAGE' | 'PER_DAY';

export interface BillingFormValues {
  allowPartial: boolean;
  minAmount: number;
  minPercentage: number;
  depositEnabled: boolean;
  depositMode: DepositMode;
  /** Rupees. Used when `depositMode` is FLAT. */
  depositAmount: number;
  depositRefundable: boolean;
  depositMonths: number;
  agreementMonths: number;
  generationDay: number;
  dueDay: number;
  graceDays: number;
  lateFeeEnabled: boolean;
  chargeType: ChargeType;
  lateFeeAmount: number;
  maxLateFee: number;
}

export interface BillingSectionMeta {
  key: BillingSectionKey;
  /** Screen title when this section is shown on its own. */
  title: string;
  subtitle: string;
  /** Route of the focused screen for this section. */
  path: string;
}

const FINANCE = '/owner/more/configuration/finance';

/** One focused screen per section. Order matches the all-settings screen. */
export const BILLING_SECTIONS: BillingSectionMeta[] = [
  {
    key: 'schedule',
    title: 'Rent schedule',
    subtitle: 'When rent is raised, due, and counted late',
    path: `${FINANCE}/rent-schedule`,
  },
  {
    key: 'collection',
    title: 'Part payments',
    subtitle: 'Whether a due can be cleared in instalments',
    path: `${FINANCE}/part-payments`,
  },
  {
    key: 'deposit',
    title: 'Security deposit',
    subtitle: 'What you collect at move-in',
    path: `${FINANCE}/deposit`,
  },
  {
    key: 'lateFee',
    title: 'Late fees',
    subtitle: 'What a tenant is charged for paying late',
    path: `${FINANCE}/late-fees`,
  },
  {
    key: 'agreement',
    title: 'Agreement duration',
    subtitle: 'Default lease length offered to new tenants',
    path: '/owner/more/configuration/hostel/agreement-duration',
  },
];

/**
 * The stored policy, read into form values.
 *
 * Shared by the form's initial state *and* the baseline the Save button's
 * visibility is judged against (config/dirtyState.ts) — they have to be derived
 * the same way, or a freshly loaded screen would look edited.
 */
export function policyToFormValues(billing: any): BillingFormValues {
  const partial = billing?.partial_payments;
  const deposit = billing?.deposit;
  const lateFee = billing?.late_fee;
  const rule = lateFee?.rules?.[0];

  return {
    allowPartial: Boolean(partial?.enabled),
    minAmount: Number(partial?.minimum_amount ?? 0) || 0,
    minPercentage: Number(partial?.minimum_percentage ?? 0) || 0,
    depositEnabled: Boolean(deposit?.enabled),
    // Anything other than the explicit MONTHS_OF_RENT is FLAT, matching
    // `depositCalculationMode` on the backend.
    depositMode: deposit?.calculation_mode === 'MONTHS_OF_RENT' ? 'MONTHS_OF_RENT' : 'FLAT',
    depositAmount: Number(deposit?.default_amount ?? 0) || 0,
    // Defaults to refundable: that is the backend default, and the safer reading
    // of an absent flag for money held on a tenant's behalf.
    depositRefundable: deposit?.refundable !== false,
    depositMonths: Number(deposit?.deposit_months ?? 1) || 1,
    agreementMonths: Number(billing?.invite_defaults?.agreement_duration_months ?? 12) || 12,
    generationDay: Number(billing?.auto_rent_day ?? 1) || 1,
    dueDay: Number(billing?.due_day ?? 5) || 5,
    graceDays: Number(billing?.grace_days ?? 0) || 0,
    lateFeeEnabled: Boolean(lateFee?.enabled),
    chargeType: (rule?.type as ChargeType) ?? 'FLAT',
    lateFeeAmount: Number(rule?.amount ?? 0) || 0,
    maxLateFee: Number(lateFee?.max_amount ?? 0) || 0,
  };
}

export function sectionMeta(key: BillingSectionKey): BillingSectionMeta {
  const found = BILLING_SECTIONS.find((section) => section.key === key);
  if (!found) throw new Error(`Unknown billing section: ${key}`);
  return found;
}

/**
 * The PATCH body for the given sections — and nothing else.
 *
 * `starts_after_days` is derived from `graceDays` even when the schedule section
 * is hidden, because the late-fee rule depends on it; omitting it would reset
 * when late fees begin applying.
 */
export function buildBillingPatch(
  values: BillingFormValues,
  sections: BillingSectionKey[],
): { billing: Record<string, unknown> } {
  const billing: Record<string, unknown> = {};
  const shown = new Set(sections);

  if (shown.has('collection')) {
    billing.partial_payments = {
      enabled: values.allowPartial,
      minimum_amount: values.minAmount || 0,
      minimum_percentage: values.minPercentage || 0,
    };
  }

  if (shown.has('deposit')) {
    // Written whole, for the same reason as the late fee, plus one of its own:
    // `resolveTenantInviteDefaults` never reads `deposit.enabled`. It resolves
    // FLAT -> security_deposit and MONTHS_OF_RENT -> deposit_months × rent, so
    // switching the deposit off while leaving MONTHS_OF_RENT stored would keep
    // collecting months × rent. "Off" therefore has to be expressed as a flat
    // ₹0 — the one shape that resolves to nothing.
    //
    // Only the active mode's amount is written, so flipping between modes
    // preserves the other value (the backend deep-merges what is omitted).
    if (!values.depositEnabled) {
      billing.deposit = {
        enabled: false,
        calculation_mode: 'FLAT',
        default_amount: 0,
        refundable: values.depositRefundable,
      };
    } else if (values.depositMode === 'FLAT') {
      billing.deposit = {
        enabled: true,
        calculation_mode: 'FLAT',
        default_amount: values.depositAmount,
        refundable: values.depositRefundable,
      };
    } else {
      billing.deposit = {
        enabled: true,
        calculation_mode: 'MONTHS_OF_RENT',
        deposit_months: values.depositMonths,
        refundable: values.depositRefundable,
      };
    }
  }

  if (shown.has('agreement')) {
    billing.invite_defaults = { agreement_duration_months: values.agreementMonths };
  }

  if (shown.has('schedule')) {
    billing.auto_rent_day = values.generationDay;
    billing.due_day = values.dueDay;
    billing.grace_days = values.graceDays;
  }

  if (shown.has('lateFee')) {
    // Always the complete shape. A partial late-fee write is precisely how the
    // superseded screen destroyed the charge type and the cap.
    billing.late_fee = values.lateFeeEnabled
      ? {
          enabled: true,
          rules: [
            {
              type: values.chargeType,
              amount: values.lateFeeAmount || 0,
              starts_after_days: values.graceDays,
            },
          ],
          max_amount: values.maxLateFee || 0,
        }
      : { enabled: false };
  }

  return { billing };
}
