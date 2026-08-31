import { describe, it, expect } from 'vitest';
import {
  normaliseMaintenanceType,
  toInviteDefaultsForm,
  buildInviteDefaultsPatch,
  describeInviteExpiry,
  previewMonthlyCharge,
  DEFAULT_INVITE_EXPIRY_HOURS,
} from './inviteDefaultsPolicy';

const policy = (over: any = {}) => ({
  billing: {
    maintenance: { type: 'MONTHLY', amount: 500 },
    invite_defaults: { auto_fill_room_rent: true, agreement_duration_months: 11 },
    ...over.billing,
  },
  tenant_rules: { invite_expiry_hours: 48, ...over.tenant_rules },
});

const form = (over: Partial<ReturnType<typeof toInviteDefaultsForm>> = {}) => ({
  useRoomRent: true,
  maintenanceAmount: 500,
  maintenanceType: 'MONTHLY' as const,
  agreementMonths: 11,
  inviteExpiryHours: 48,
  ...over,
});

describe('toInviteDefaultsForm', () => {
  it('reads the three values that repeat on every invite', () => {
    expect(toInviteDefaultsForm(policy())).toEqual({
      useRoomRent: true,
      maintenanceAmount: 500,
      maintenanceType: 'MONTHLY',
      agreementMonths: 11,
      inviteExpiryHours: 48,
    });
  });

  it('treats an absent room-rent flag as on', () => {
    // The backend default, and the behaviour an owner who has never opened
    // this screen already has.
    expect(toInviteDefaultsForm({ billing: {} }).useRoomRent).toBe(true);
  });

  it('falls back to a sane invite expiry rather than zero', () => {
    // Zero would read as "never expires", which is not what a missing value
    // means.
    expect(toInviteDefaultsForm({}).inviteExpiryHours).toBe(DEFAULT_INVITE_EXPIRY_HOURS);
    expect(toInviteDefaultsForm({ tenant_rules: { invite_expiry_hours: 0 } }).inviteExpiryHours)
      .toBe(DEFAULT_INVITE_EXPIRY_HOURS);
  });

  it('reports no maintenance when the hostel charges none', () => {
    expect(toInviteDefaultsForm({ billing: { maintenance: null } }).maintenanceAmount).toBe(0);
  });

  it('survives an empty policy', () => {
    expect(toInviteDefaultsForm(null).agreementMonths).toBe(0);
  });
});

describe('buildInviteDefaultsPatch', () => {
  it('writes the maintenance shape whole, type included', () => {
    // `maintenance` carries a type alongside its amount. Writing the amount
    // alone would leave a stale type describing a charge that no longer
    // matches — the bug the late-fee shape already had to fix once.
    expect(buildInviteDefaultsPatch(form()).billing.maintenance).toEqual({ type: 'MONTHLY', amount: 500 });
  });

  it('turns the maintenance type off when the amount is cleared', () => {
    expect(buildInviteDefaultsPatch(form({ maintenanceAmount: 0 })).billing.maintenance)
      .toEqual({ type: 'NONE', amount: 0 });
  });

  it('writes the invite defaults and the expiry', () => {
    const patch = buildInviteDefaultsPatch(form());
    expect(patch.billing.invite_defaults).toEqual({
      auto_fill_room_rent: true,
      agreement_duration_months: 11,
    });
    expect(patch.tenant_rules).toEqual({ invite_expiry_hours: 48 });
  });

  it('touches nothing it does not own', () => {
    // Deposit and rent cycle have their own screens. A second editor for one
    // value is how two screens start disagreeing about it.
    const patch = buildInviteDefaultsPatch(form()) as any;
    expect(patch.billing.deposit).toBeUndefined();
    expect(patch.billing.rent_cycle).toBeUndefined();
    expect(patch.billing.late_fee).toBeUndefined();
  });
});

describe('maintenance type', () => {
  it('keeps a one-time charge out of the monthly total', () => {
    // The whole reason the two types exist: the same ₹2,000 is ₹24,000 a year
    // or ₹2,000 once, and adding a joining fee into a monthly figure is the
    // confusion this is meant to remove.
    expect(previewMonthlyCharge(form({ maintenanceType: 'ONE_TIME' }), 9500))
      .toBe('₹9,500 a month, plus ₹500 once at move-in');
  });

  it('adds a monthly charge into the monthly total', () => {
    expect(previewMonthlyCharge(form(), 9500)).toContain('= ₹10,000 a month');
  });

  it('treats a stored amount with no type as monthly', () => {
    // The backend column defaults to MONTHLY, and that is what every tenancy
    // created before the type was selectable actually got.
    expect(normaliseMaintenanceType(undefined, 500)).toBe('MONTHLY');
    expect(normaliseMaintenanceType('', 500)).toBe('MONTHLY');
  });

  it('is NONE whenever the amount is cleared, whatever type was stored', () => {
    // A cleared charge must not leave a type behind that still describes one.
    expect(normaliseMaintenanceType('ONE_TIME', 0)).toBe('NONE');
    expect(normaliseMaintenanceType('MONTHLY', 0)).toBe('NONE');
  });

  it('saves the chosen type', () => {
    expect(buildInviteDefaultsPatch(form({ maintenanceType: 'ONE_TIME' })).billing.maintenance)
      .toEqual({ type: 'ONE_TIME', amount: 500 });
  });
});

describe('describeInviteExpiry', () => {
  it('says days when the hours divide evenly', () => {
    expect(describeInviteExpiry(48)).toBe('2 days');
    expect(describeInviteExpiry(24)).toBe('1 day');
  });

  it('keeps hours when they do not', () => {
    expect(describeInviteExpiry(12)).toBe('12 hours');
    expect(describeInviteExpiry(1)).toBe('1 hour');
  });

  it('says so when an invite never expires', () => {
    expect(describeInviteExpiry(0)).toBe('Never expires');
  });
});

describe('previewMonthlyCharge', () => {
  it('adds maintenance to the room rent', () => {
    expect(previewMonthlyCharge(form(), 9500)).toBe('₹9,500 + ₹500 maintenance = ₹10,000 a month');
  });

  it('omits maintenance when none is charged', () => {
    expect(previewMonthlyCharge(form({ maintenanceAmount: 0 }), 9500)).toBe('₹9,500 a month');
  });

  it('says rent is typed per tenant when auto-fill is off', () => {
    expect(previewMonthlyCharge(form({ useRoomRent: false }), 9500)).toContain('typed per tenant');
  });

  it('says the same when no room rent is known', () => {
    expect(previewMonthlyCharge(form(), null)).toContain('typed per tenant');
  });
});
