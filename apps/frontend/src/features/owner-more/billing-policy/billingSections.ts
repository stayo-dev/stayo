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

export type BillingSectionKey = 'collection' | 'deposit' | 'agreement' | 'schedule' | 'lateFee';

export type ChargeType = 'FLAT' | 'PERCENTAGE' | 'PER_DAY';

export interface BillingFormValues {
  allowPartial: boolean;
  minAmount: number;
  minPercentage: number;
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
    billing.deposit = { deposit_months: values.depositMonths };
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
