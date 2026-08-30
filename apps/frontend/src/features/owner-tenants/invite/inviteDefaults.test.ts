import { describe, it, expect } from 'vitest';
import { inviteDefaults, depositFor, billingLabelFor, applyInviteDefaults } from './inviteDefaults';

const policy = (over: any = {}) => ({
  billing: {
    rent_cycle: 'MONTHLY',
    maintenance: { type: 'MONTHLY', amount: 500 },
    deposit: { enabled: true, default_amount: 20000, calculation_mode: 'FLAT' },
    invite_defaults: { auto_fill_room_rent: true, agreement_duration_months: 6 },
    ...over,
  },
});

describe('inviteDefaults', () => {
  it("fills the room's own rent when the hostel asked for that", () => {
    // `auto_fill_room_rent` was stored and normalised on the backend and read
    // by nothing. This is the behaviour it was always supposed to have.
    expect(inviteDefaults(policy(), { baseRent: 9500 }).monthlyRent).toBe('9500');
  });

  it('leaves rent blank when the hostel switched auto-fill off', () => {
    const p = policy({ invite_defaults: { auto_fill_room_rent: false, agreement_duration_months: 6 } });
    expect(inviteDefaults(p, { baseRent: 9500 }).monthlyRent).toBe('');
  });

  it('leaves rent blank rather than inventing a figure when no room is chosen', () => {
    // A blank field beats a wrong one. The form used to ship a hardcoded
    // ₹8,000, which every owner in the country corrected on every invite —
    // and any owner who failed to notice put a wrong rent on a real tenancy.
    expect(inviteDefaults(policy(), null).monthlyRent).toBe('');
  });

  it('carries the maintenance charge, which had no editor at all before', () => {
    expect(inviteDefaults(policy(), { baseRent: 9500 }).maintenance).toBe('500');
  });

  it('omits maintenance when the hostel does not charge it', () => {
    expect(inviteDefaults(policy({ maintenance: { amount: 0 } })).maintenance).toBe('');
    expect(inviteDefaults(policy({ maintenance: null })).maintenance).toBe('');
  });

  it('uses the agreement length the hostel set, and says nothing when it has not', () => {
    expect(inviteDefaults(policy()).agreementMonths).toBe('6');
    expect(inviteDefaults(policy({ invite_defaults: {} })).agreementMonths).toBe('');
  });

  it('survives a missing policy entirely', () => {
    expect(inviteDefaults(null)).toEqual({
      monthlyRent: '',
      deposit: '',
      maintenance: '',
      agreementMonths: '',
      billing: 'Monthly',
    });
  });
});

describe('depositFor', () => {
  it('uses the flat amount the hostel set', () => {
    expect(depositFor(policy(), '9500')).toBe('20000');
  });

  it('multiplies the rent when the hostel charges months of rent', () => {
    // Stays two months' rent when the rent changes, rather than freezing into
    // a stale figure.
    const p = policy({ deposit: { enabled: true, calculation_mode: 'MONTHS_OF_RENT', deposit_months: 2 } });
    expect(depositFor(p, '9500')).toBe('19000');
  });

  it('says nothing when it would have to guess the rent', () => {
    const p = policy({ deposit: { enabled: true, calculation_mode: 'MONTHS_OF_RENT', deposit_months: 2 } });
    expect(depositFor(p, '')).toBe('');
  });

  it('is empty when the hostel takes no deposit', () => {
    expect(depositFor(policy({ deposit: { enabled: false, default_amount: 20000 } }), '9500')).toBe('');
    expect(depositFor(policy({ deposit: null }), '9500')).toBe('');
  });

  it('rounds rather than emitting a fraction into a money field', () => {
    const p = policy({ deposit: { enabled: true, calculation_mode: 'MONTHS_OF_RENT', deposit_months: 1.5 } });
    expect(depositFor(p, '9501')).toBe('14252');
  });
});

describe('billingLabelFor', () => {
  it('translates the stored token into the label the form shows', () => {
    expect(billingLabelFor('QUARTERLY')).toBe('Quarterly');
    expect(billingLabelFor('HALF_YEARLY')).toBe('Half-yearly');
    expect(billingLabelFor('ACADEMIC_YEARLY')).toBe('Academic year');
  });

  it('falls back to Monthly, which is what nearly every tenancy uses', () => {
    expect(billingLabelFor(null)).toBe('Monthly');
    expect(billingLabelFor('SOMETHING_NEW')).toBe('Monthly');
  });
});

describe('applyInviteDefaults', () => {
  const defaults = { monthlyRent: '9500', deposit: '19000', maintenance: '500', agreementMonths: '6', billing: 'Monthly' };

  it('fills fields the owner has left blank', () => {
    expect(applyInviteDefaults({ monthlyRent: '', deposit: '' }, defaults)).toMatchObject({
      monthlyRent: '9500',
      deposit: '19000',
    });
  });

  it('never overwrites a figure the owner already typed', () => {
    // An agreed rent that differs from the room's list price is common.
    // Replacing it silently would be the hardcoded-₹8,000 bug again, later.
    const patch = applyInviteDefaults({ monthlyRent: '11000' }, defaults);
    expect(patch.monthlyRent).toBeUndefined();
    expect(patch.deposit).toBe('19000');
  });

  it('treats whitespace as blank', () => {
    expect(applyInviteDefaults({ monthlyRent: '   ' }, defaults).monthlyRent).toBe('9500');
  });

  it('suggests nothing where the default itself is empty', () => {
    const patch = applyInviteDefaults({}, { ...defaults, maintenance: '' });
    expect('maintenance' in patch).toBe(false);
  });
});
