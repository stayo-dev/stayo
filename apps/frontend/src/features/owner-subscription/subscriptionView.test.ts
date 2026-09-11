import { describe, expect, it } from 'vitest';
import type {
  OwnerSubscription,
  PlanSummary,
  SubscriptionInvoice,
  SubscriptionPayment,
  SubscriptionUsage,
} from './api';
import {
  buildPlanCards,
  capacityLabel,
  deriveCapacityView,
  deriveStatusView,
  downgradeNotice,
  formatMonthlyPrice,
  formatPaise,
  formatPeriod,
  hasOpenPayment,
  initialExtraBedsForSelection,
  invoiceRowView,
  mapBackendError,
  needsPaymentAction,
  openPayment,
  paymentStatusView,
  planRelation,
  validatePaymentForm,
} from './subscriptionView';

const plan = (over: Partial<PlanSummary>): PlanSummary => ({
  id: 'p',
  code: 'STARTER',
  name: 'Starter',
  price_paise: 149900,
  currency: 'INR',
  billing_cycle: 'MONTHLY',
  capacity_min: 1,
  capacity_max: 60,
  included_beds: 50,
  max_extra_beds: 10,
  extra_bed_price_paise: 1000,
  is_public: true,
  ...over,
});

const sub = (over: Partial<OwnerSubscription>): OwnerSubscription => ({
  id: 's',
  status: 'ACTIVE',
  plan: {
    id: 'p-growth',
    code: 'GROWTH',
    name: 'Growth',
    price_paise: 249900,
    currency: 'INR',
    capacity_max: 125,
    included_beds: 100,
    max_extra_beds: 25,
    extra_bed_price_paise: 1000,
  },
  extra_beds: 0,
  pending_plan: null,
  trial_ends_at: null,
  current_period_start: '2026-09-01',
  current_period_end: '2026-10-01',
  next_renewal_at: '2026-10-01',
  started_at: '2026-06-01',
  cancelled_at: null,
  ...over,
});

// ── money / dates ─────────────────────────────────────────────────────────
describe('formatting', () => {
  it('formats paise as rupees', () => {
    expect(formatPaise(149900)).toBe('₹1,499');
    expect(formatPaise(249900)).toBe('₹2,499');
    expect(formatPaise(null)).toBe('—');
  });
  it('marks PORTFOLIO as a "from" price', () => {
    expect(formatMonthlyPrice(799900, 'PORTFOLIO')).toBe('₹7,999+/month');
    expect(formatMonthlyPrice(149900, 'STARTER')).toBe('₹1,499/month');
  });
  it('formats a billing period', () => {
    expect(formatPeriod('2026-09-01', '2026-10-01')).toMatch(/01 Sept? – 01 Oct 2026/);
  });
});

// ── status ────────────────────────────────────────────────────────────────
describe('deriveStatusView', () => {
  it('ACTIVE → positive, no payment CTA', () => {
    const v = deriveStatusView(sub({ status: 'ACTIVE' }));
    expect(v.tone).toBe('positive');
    expect(v.headline).toBe('Subscription active');
    expect(v.primaryAction).toBeNull();
  });

  it('PENDING_PAYMENT → "Payment required to start managing Stayo" + choose-plan CTA', () => {
    const v = deriveStatusView(sub({ status: 'PENDING_PAYMENT' }));
    expect(v.headline).toBe('Payment required to start managing Stayo');
    expect(v.primaryAction).toBe('CHOOSE_PLAN');
  });

  it('PAUSED → explains the period ended + renew CTA', () => {
    const v = deriveStatusView(sub({ status: 'PAUSED' }));
    expect(v.tone).toBe('critical');
    expect(v.headline).toMatch(/paused because the paid period has ended/i);
    expect(v.primaryAction).toBe('RENEW');
  });

  it('CANCELLED → neutral, reactivation path', () => {
    const v = deriveStatusView(sub({ status: 'CANCELLED' }));
    expect(v.primaryAction).toBe('CHOOSE_PLAN');
  });

  it('legacy TRIAL is NEVER presented as a fresh trial', () => {
    const v = deriveStatusView(sub({ status: 'TRIAL' }));
    expect(v.label).toBe('Payment required');
    expect(v.body).toMatch(/does not run a trial/i);
    expect(v.primaryAction).toBe('CHOOSE_PLAN');
  });

  it('needsPaymentAction is true for every non-ACTIVE status', () => {
    for (const s of ['PENDING_PAYMENT', 'PAUSED', 'EXPIRED', 'TRIAL', 'CANCELLED'] as const) {
      expect(needsPaymentAction(s)).toBe(true);
    }
    expect(needsPaymentAction('ACTIVE')).toBe(false);
  });
});

// ── capacity ──────────────────────────────────────────────────────────────
describe('deriveCapacityView', () => {
  const usage = (over: Partial<SubscriptionUsage>): SubscriptionUsage => ({
    plan_code: 'STARTER',
    used: 32,
    capacity_max: 50,
    available: 18,
    at_limit: false,
    ...over,
  });

  it('shows "used / cap" and no message when comfortably under', () => {
    const v = deriveCapacityView(usage({ used: 32, capacity_max: 50 }))!;
    expect(v.text).toBe('32 / 50');
    expect(v.state).toBe('ok');
    expect(v.message).toBeNull();
  });

  it('GROWTH 87/100 → approaching, warns', () => {
    const v = deriveCapacityView(usage({ plan_code: 'GROWTH', used: 87, capacity_max: 100 }))!;
    expect(v.text).toBe('87 / 100');
    // 87% — under the 90% approaching band
    expect(v.state).toBe('ok');
    const v2 = deriveCapacityView(usage({ used: 95, capacity_max: 100 }))!;
    expect(v2.state).toBe('approaching');
    expect(v2.message).toMatch(/close to your plan's limit/i);
  });

  it('at the ceiling → at_limit + upgrade message', () => {
    const v = deriveCapacityView(usage({ used: 50, capacity_max: 50, at_limit: true }))!;
    expect(v.state).toBe('at_limit');
    expect(v.message).toMatch(/Plan capacity reached\. Upgrade/i);
  });

  it('FOUNDING (capacity_max null) → "Unlimited", no bar, no message', () => {
    const v = deriveCapacityView(usage({ plan_code: 'FOUNDING', capacity_max: null, available: null }))!;
    expect(v.text).toBe('Unlimited');
    expect(v.unlimited).toBe(true);
    expect(v.ratio).toBeNull();
    expect(v.message).toBeNull();
  });

  it('returns null when the backend gave no usage', () => {
    expect(deriveCapacityView(null)).toBeNull();
  });
});

// ── plans ─────────────────────────────────────────────────────────────────
describe('plans', () => {
  it('capacityLabel: legacy min–max range when included_beds is absent, "Unlimited" for a null ceiling', () => {
    expect(
      capacityLabel({ capacity_min: 51, capacity_max: 100, included_beds: null, max_extra_beds: null, extra_bed_price_paise: null }),
    ).toBe('51–100 active tenants');
    expect(
      capacityLabel({ capacity_min: 1, capacity_max: null, included_beds: null, max_extra_beds: null, extra_bed_price_paise: null }),
    ).toBe('Unlimited active tenants');
  });

  it('capacityLabel: included vs. extra beds (business rules, 2026-09-10)', () => {
    expect(capacityLabel(plan({ included_beds: 50, max_extra_beds: 10, extra_bed_price_paise: 1000 }))).toBe(
      '50 beds included, up to 10 extra (₹10/bed)',
    );
    expect(capacityLabel(plan({ included_beds: 250, max_extra_beds: null, extra_bed_price_paise: 1000 }))).toBe(
      '250 beds included, unlimited extra beds (₹10/bed)',
    );
    expect(capacityLabel(plan({ included_beds: 500, max_extra_beds: 0, extra_bed_price_paise: null }))).toBe(
      '500 beds included',
    );
  });

  it('planRelation classifies against the current plan price', () => {
    const active = sub({ status: 'ACTIVE', plan: { id: 'p-growth', code: 'GROWTH', name: 'Growth', price_paise: 249900, currency: 'INR', capacity_max: 125, included_beds: 100, max_extra_beds: 25, extra_bed_price_paise: 1000 } });
    expect(planRelation('ACTIVE', 'p-growth', 249900, plan({ id: 'p-growth', price_paise: 249900 }))).toBe('CURRENT');
    expect(planRelation('ACTIVE', 'p-growth', 249900, plan({ id: 'p-pro', price_paise: 449900 }))).toBe('UPGRADE');
    expect(planRelation('ACTIVE', 'p-growth', 249900, plan({ id: 'p-starter', price_paise: 149900 }))).toBe('DOWNGRADE');
    expect(planRelation('PENDING_PAYMENT', null, null, plan({ id: 'p-starter' }))).toBe('NEW');
    void active;
  });

  it('initialExtraBedsForSelection (Phase 6.6): carries current extra beds forward only for a genuine UPGRADE', () => {
    // An upgrade must never silently drop already-paid recurring beds by
    // defaulting the form to 0.
    expect(initialExtraBedsForSelection('UPGRADE', 8)).toBe(8);
    expect(initialExtraBedsForSelection('UPGRADE', 0)).toBe(0);
    // Every other relation starts fresh — a DOWNGRADE never even shows the
    // extra-beds input; NEW/RENEWAL are a fresh opt-in.
    expect(initialExtraBedsForSelection('NEW', 8)).toBe(0);
    expect(initialExtraBedsForSelection('RENEWAL', 8)).toBe(0);
    expect(initialExtraBedsForSelection('DOWNGRADE', 8)).toBe(0);
    expect(initialExtraBedsForSelection('CURRENT', 8)).toBe(0);
  });

  it('buildPlanCards marks the current + pending plan and computes relation', () => {
    const s = sub({
      status: 'ACTIVE',
      plan: { id: 'p-growth', code: 'GROWTH', name: 'Growth', price_paise: 249900, currency: 'INR', capacity_max: 125, included_beds: 100, max_extra_beds: 25, extra_bed_price_paise: 1000 },
      pending_plan: { id: 'p-starter', code: 'STARTER', name: 'Starter', price_paise: 149900 },
    });
    const cards = buildPlanCards(
      [
        plan({ id: 'p-starter', code: 'STARTER', price_paise: 149900 }),
        plan({ id: 'p-growth', code: 'GROWTH', price_paise: 249900, capacity_max: 100 }),
        plan({ id: 'p-pro', code: 'PROFESSIONAL', price_paise: 449900, capacity_max: 250 }),
      ],
      s,
    );
    expect(cards.find((c) => c.id === 'p-growth')!.isCurrent).toBe(true);
    expect(cards.find((c) => c.id === 'p-starter')!.isPending).toBe(true);
    expect(cards.find((c) => c.id === 'p-pro')!.relation).toBe('UPGRADE');
  });
});

// ── downgrade messaging ───────────────────────────────────────────────────
describe('downgrade messaging', () => {
  it('says the current plan stays and the switch is at next renewal', () => {
    const msg = downgradeNotice('Starter', '2026-10-01');
    expect(msg).toMatch(/current plan stays active/i);
    expect(msg).toMatch(/takes effect on 01 Oct 2026/i);
    expect(msg).toMatch(/not charged twice/i);
    expect(msg).not.toMatch(/immediately/i);
  });
});

// ── payments ──────────────────────────────────────────────────────────────
describe('payments', () => {
  const pmt = (over: Partial<SubscriptionPayment>): SubscriptionPayment => ({
    id: 'x',
    plan_id: 'p',
    amount_paise: 149900,
    extra_beds: 0,
    currency: 'INR',
    payment_method: 'UPI_MANUAL',
    transaction_reference: 'UTR1',
    status: 'SUBMITTED',
    rejection_reason: null,
    submitted_at: '2026-09-10',
    reviewed_at: null,
    ...over,
  });

  it('hasOpenPayment / openPayment detect SUBMITTED and UNDER_REVIEW', () => {
    expect(hasOpenPayment([pmt({ status: 'APPROVED' }), pmt({ status: 'SUBMITTED' })])).toBe(true);
    expect(hasOpenPayment([pmt({ status: 'APPROVED' }), pmt({ status: 'REJECTED' })])).toBe(false);
    expect(openPayment([pmt({ status: 'REJECTED' }), pmt({ id: 'open', status: 'UNDER_REVIEW' })])!.id).toBe('open');
  });

  it('paymentStatusView maps every status to a label + tone', () => {
    expect(paymentStatusView('APPROVED')).toEqual({ label: 'Approved', tone: 'positive' });
    expect(paymentStatusView('REJECTED')).toEqual({ label: 'Rejected', tone: 'critical' });
    expect(paymentStatusView('UNDER_REVIEW')).toEqual({ label: 'Under review', tone: 'info' });
    expect(paymentStatusView('SUBMITTED')).toEqual({ label: 'Submitted', tone: 'warning' });
  });
});

// ── payment form validation (mirrors backend) ─────────────────────────────
describe('validatePaymentForm', () => {
  it('needs a method and a positive integer amount', () => {
    expect(validatePaymentForm({ method: '', amountPaise: 149900, transactionReference: '', proofFileUrl: null }).ok).toBe(false);
    expect(validatePaymentForm({ method: 'CASH', amountPaise: 0, transactionReference: '', proofFileUrl: null }).ok).toBe(false);
    expect(validatePaymentForm({ method: 'CASH', amountPaise: 12.5, transactionReference: '', proofFileUrl: null }).ok).toBe(false);
  });

  it('CASH is valid with just a method + amount', () => {
    expect(validatePaymentForm({ method: 'CASH', amountPaise: 149900, transactionReference: '', proofFileUrl: null })).toEqual({ ok: true });
  });

  it('UPI_MANUAL requires both a reference and a proof file', () => {
    expect(validatePaymentForm({ method: 'UPI_MANUAL', amountPaise: 149900, transactionReference: '', proofFileUrl: 'u' }).ok).toBe(false);
    expect(validatePaymentForm({ method: 'UPI_MANUAL', amountPaise: 149900, transactionReference: 'UTR', proofFileUrl: null }).ok).toBe(false);
    expect(validatePaymentForm({ method: 'UPI_MANUAL', amountPaise: 149900, transactionReference: 'UTR', proofFileUrl: 'u' })).toEqual({ ok: true });
  });
});

// ── backend errors ────────────────────────────────────────────────────────
describe('mapBackendError', () => {
  const err = (code: string, message = 'raw') => ({ response: { data: { error: { code, message } } } });

  it('maps known codes to friendly messages', () => {
    expect(mapBackendError(err('SUBSCRIPTION_CAPACITY_REACHED'))).toMatch(/active-tenant limit\. Upgrade/i);
    expect(mapBackendError(err('FOUNDING_FULL'))).toMatch(/first 10 owners and is now full/i);
    expect(mapBackendError(err('PAYMENT_ALREADY_PENDING'))).toMatch(/already have a payment awaiting review/i);
    expect(mapBackendError(err('SUBSCRIPTION_INACTIVE'))).toMatch(/not active yet/i);
    expect(mapBackendError(err('NOT_AN_UPGRADE'))).toMatch(/not an upgrade/i);
    expect(mapBackendError(err('INVALID_PAYMENT'))).toMatch(/check the payment details/i);
  });

  it('passes through a clean backend message for an unknown code', () => {
    expect(mapBackendError({ response: { data: { error: { code: 'WHATEVER', message: 'Plan is inactive.' } } } })).toBe('Plan is inactive.');
  });

  it('never leaks a stack trace / db error', () => {
    const leaky = { response: { data: { error: { code: 'X', message: 'Error: connect ECONNREFUSED 127.0.0.1:5432\n  at TCPConnectWrap' } } } };
    expect(mapBackendError(leaky, 'fallback')).toBe('fallback');
  });

  it('falls back when there is nothing usable', () => {
    expect(mapBackendError(new Error('boom'), 'friendly fallback')).toBe('friendly fallback');
  });
});

const invoice = (over: Partial<SubscriptionInvoice> = {}): SubscriptionInvoice => ({
  id: 'inv-1',
  invoice_number: 'SUB-2026-A1B2C3D4E5',
  plan_name: 'Growth',
  amount_paise: 249900,
  extra_beds: 0,
  plan_amount_paise: 249900,
  extra_bed_unit_price_paise: null,
  extra_bed_amount_paise: 0,
  tax_paise: 0,
  currency: 'INR',
  billing_period_start: '2026-09-10',
  billing_period_end: '2026-10-10',
  payment_method: 'UPI_MANUAL',
  issued_at: '2026-09-10T08:00:00.000Z',
  document_ready: true,
  ...over,
});

describe('invoiceRowView', () => {
  it('formats an invoice row from backend values only', () => {
    const v = invoiceRowView(invoice());
    expect(v.invoiceNumber).toBe('SUB-2026-A1B2C3D4E5');
    expect(v.planLabel).toBe('Growth');
    expect(v.amountLabel).toBe('₹2,499');
    expect(v.methodLabel).toBe('UPI (manual)');
    expect(v.issuedLabel).toMatch(/2026/);
    expect(v.periodLabel).not.toBe('—');
  });

  it('marks a ready document downloadable and a missing one pending', () => {
    expect(invoiceRowView(invoice({ document_ready: true })).documentState).toBe('ready');
    expect(invoiceRowView(invoice({ document_ready: false })).documentState).toBe('pending');
  });

  it('falls back to a generic plan label when none is stored', () => {
    expect(invoiceRowView(invoice({ plan_name: null })).planLabel).toBe('Stayo subscription');
  });

  it('produces a filesystem-safe download filename from the invoice number', () => {
    expect(invoiceRowView(invoice({ invoice_number: 'SUB 2026/AB CD' })).downloadFilename).toBe('SUB-2026-AB-CD.pdf');
  });

  it('shows a prorated upgrade amount exactly as returned', () => {
    expect(invoiceRowView(invoice({ amount_paise: 133733 })).amountLabel).toBe('₹1,337');
  });

  describe('extra-bed breakdown (Phase 6.6)', () => {
    it('no extra beds: extraBedsLabel and extraBedAmountLabel are both null', () => {
      const v = invoiceRowView(invoice());
      expect(v.extraBedsLabel).toBeNull();
      expect(v.extraBedAmountLabel).toBeNull();
      expect(v.planAmountLabel).toBe('₹2,499');
    });

    it('shows quantity + snapshotted unit price + amount, all from backend values only', () => {
      const v = invoiceRowView(
        invoice({
          amount_paise: 259900,
          plan_amount_paise: 249900,
          extra_beds: 10,
          extra_bed_unit_price_paise: 1000,
          extra_bed_amount_paise: 10000,
        }),
      );
      expect(v.extraBedsLabel).toBe('10 extra beds @ ₹10/bed');
      expect(v.planAmountLabel).toBe('₹2,499');
      expect(v.extraBedAmountLabel).toBe('₹100');
    });

    it('singular label for exactly 1 extra bed', () => {
      const v = invoiceRowView(invoice({ extra_beds: 1, extra_bed_unit_price_paise: 1000, extra_bed_amount_paise: 1000 }));
      expect(v.extraBedsLabel).toBe('1 extra bed @ ₹10/bed');
    });
  });
});
