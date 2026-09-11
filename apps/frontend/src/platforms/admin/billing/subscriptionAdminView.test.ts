import { describe, expect, it } from 'vitest';
import {
  adminError,
  availableActions,
  canActivateFounding,
  capacityText,
  isReviewablePayment,
  overrideActive,
  paymentStatusView,
  planLabel,
  revenueTiles,
  subStatusView,
} from './subscriptionAdminView';

describe('subStatusView', () => {
  it('maps the four live statuses', () => {
    expect(subStatusView('ACTIVE')).toEqual({ label: 'Active', tone: 'ok' });
    expect(subStatusView('PENDING_PAYMENT')).toEqual({ label: 'Payment pending', tone: 'warn' });
    expect(subStatusView('PAUSED')).toEqual({ label: 'Paused', tone: 'bad' });
    expect(subStatusView('CANCELLED')).toEqual({ label: 'Cancelled', tone: 'muted' });
  });
  it('legacy TRIAL is shown as awaiting payment, never as a live trial', () => {
    expect(subStatusView('TRIAL').label).toBe('Awaiting payment');
  });
});

describe('planLabel', () => {
  it('FOUNDING → "Founding — ₹2,000/month — Unlimited" (no 50-tenant limit)', () => {
    expect(planLabel({ code: 'FOUNDING', name: 'Founding', price_paise: 200000, capacity_max: null })).toBe(
      'Founding — ₹2,000/month — Unlimited',
    );
  });
  it('a capped plan shows its range', () => {
    expect(planLabel({ name: 'Growth', price_paise: 249900, capacity_min: 51, capacity_max: 100 })).toBe(
      'Growth — ₹2,499/month — 51–100',
    );
  });
  it('null plan → dash', () => {
    expect(planLabel(null)).toBe('—');
  });
});

describe('capacityText', () => {
  it('"73 / 100" for a capped plan, "Unlimited" for FOUNDING', () => {
    expect(capacityText({ used: 73, capacity_max: 100 })).toBe('73 / 100');
    expect(capacityText({ used: 5000, capacity_max: null })).toBe('Unlimited');
    expect(capacityText(null)).toBe('—');
  });
});

describe('availableActions', () => {
  it('ACTIVE → pause / extend / change-plan / cash (no resume)', () => {
    expect(availableActions('ACTIVE')).toEqual(['pause', 'extend', 'change-plan', 'cash']);
  });
  it('PAUSED → resume / extend / change-plan / cash (no pause)', () => {
    expect(availableActions('PAUSED')).toEqual(['resume', 'extend', 'change-plan', 'cash']);
  });
  it('CANCELLED → only change-plan / cash', () => {
    expect(availableActions('CANCELLED')).toEqual(['change-plan', 'cash']);
  });
});

describe('canActivateFounding', () => {
  it('true only for a FOUNDING subscription still PENDING_PAYMENT', () => {
    expect(canActivateFounding('PENDING_PAYMENT', 'FOUNDING')).toBe(true);
  });
  it('false for FOUNDING once already ACTIVE', () => {
    expect(canActivateFounding('ACTIVE', 'FOUNDING')).toBe(false);
  });
  it('false for a non-FOUNDING plan even if PENDING_PAYMENT', () => {
    expect(canActivateFounding('PENDING_PAYMENT', 'STARTER')).toBe(false);
    expect(canActivateFounding('PENDING_PAYMENT', null)).toBe(false);
  });
});

describe('payment helpers', () => {
  it('isReviewablePayment → SUBMITTED / UNDER_REVIEW only', () => {
    expect(isReviewablePayment('SUBMITTED')).toBe(true);
    expect(isReviewablePayment('UNDER_REVIEW')).toBe(true);
    expect(isReviewablePayment('APPROVED')).toBe(false);
    expect(isReviewablePayment('REJECTED')).toBe(false);
  });
  it('paymentStatusView maps every status', () => {
    expect(paymentStatusView('APPROVED').tone).toBe('ok');
    expect(paymentStatusView('REJECTED').tone).toBe('bad');
    expect(paymentStatusView('UNDER_REVIEW').label).toBe('Under review');
  });
});

describe('overrideActive', () => {
  const now = new Date('2026-09-15T00:00:00Z');
  it('true for a future override, false for a past one or none', () => {
    expect(overrideActive('2026-09-20T00:00:00Z', now)).toBe(true);
    expect(overrideActive('2026-09-10T00:00:00Z', now)).toBe(false);
    expect(overrideActive(null, now)).toBe(false);
  });
});

describe('revenueTiles', () => {
  it('formats paise KPIs and passes counts through', () => {
    const t = revenueTiles({
      kpis: { mrr_paise: 749500, arr_paise: 8994000, collected_this_month_paise: 399800, lifetime_paise: 1249100 },
      subscriptions: { active: 6 },
      payments: { pending_review: 2 },
    });
    expect(t.mrr).toBe('₹7,495');
    expect(t.arr).toBe('₹89,940');
    expect(t.activeSubs).toBe(6);
    expect(t.pendingReview).toBe(2);
  });
});

describe('adminError', () => {
  const e = (code: string, message = 'raw') => ({ response: { data: { error: { code, message } } } });
  it('maps the required codes', () => {
    expect(adminError(e('FOUNDING_FULL'))).toMatch(/first 10 owners/i);
    expect(adminError(e('SUBSCRIPTION_CAPACITY_REACHED'))).toMatch(/next renewal instead/i);
    expect(adminError(e('PAYMENT_ALREADY_PENDING'))).toMatch(/awaiting review/i);
    expect(adminError(e('NOT_REVIEWABLE'))).toMatch(/already been reviewed/i);
    expect(adminError(e('OVERRIDE_TOO_LONG'))).toMatch(/30 days per action/i);
    expect(adminError(e('INVALID_TRANSITION'))).toMatch(/not allowed/i);
    expect(adminError(e('FORBIDDEN'))).toMatch(/permission/i);
  });
  it('passes a clean message through and hides a leaky one', () => {
    expect(adminError({ response: { data: { error: { code: 'X', message: 'Owner not found.' } } } })).toBe('Owner not found.');
    expect(
      adminError({ response: { data: { error: { code: 'X', message: 'Error: connect ECONNREFUSED\n  at TCP' } } } }, 'fallback'),
    ).toBe('fallback');
  });
});
