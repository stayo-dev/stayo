import { describe, expect, it } from 'vitest';
import { deriveFinanceSections, deriveHostelSections, ordinalDay, type ConfigSource } from './deriveConfigSections';
import { tallyConfigRows } from './configRows';

const source = (overrides: Partial<ConfigSource> = {}): ConfigSource => ({
  hostel: { name: 'Sunrise Residency', phone: '9876543210', address: '12 Main Rd', city: 'Guntur', gst_number: null },
  policy: {
    billing: {
      auto_rent_day: 1,
      due_day: 5,
      grace_days: 3,
      late_fee: { enabled: true, rules: [{ type: 'PER_DAY', amount: 50 }] },
      deposit: { enabled: true, deposit_months: 1, refundable: true, default_amount: 0 },
      invite_defaults: { agreement_duration_months: 3 },
    },
    receipts: { prefix: 'SRI', format: 'PREFIX-YEAR-SEQ', auto_email: true, footer: 'Thanks' },
    branding: { logo_url: null, primary_color: null, accent_color: null },
    tenant_rules: { invite_expiry_hours: 48, required_profile_fields: ['phone'] },
  },
  counts: { properties: 3, floors: 3, rooms: 14, beds: 137 },
  ...overrides,
});

const allRows = (sections: { rows: unknown[] }[]) => sections.flatMap((s) => s.rows) as ReturnType<typeof deriveHostelSections>[number]['rows'];
const find = (sections: ReturnType<typeof deriveHostelSections>, key: string) =>
  sections.flatMap((s) => s.rows).find((r) => r.key === key)!;

describe('ordinalDay', () => {
  it.each([
    [1, '1st'],
    [2, '2nd'],
    [3, '3rd'],
    [4, '4th'],
    [5, '5th'],
    [11, '11th'],
    [21, '21st'],
    [22, '22nd'],
    [23, '23rd'],
  ])('renders %i as %s', (day, expected) => {
    // The screen this replaces hardcoded `${day}st`, which printed "2st" for
    // any hostel generating rent on the 2nd.
    expect(ordinalDay(day)).toBe(expected);
  });
});

describe('deriveHostelSections', () => {
  it('marks hostel identity configured and names the property count', () => {
    const row = find(deriveHostelSections(source()), 'hostel-identity');

    expect(row.state).toBe('configured');
    expect(row.detail).toContain('Sunrise Residency');
    expect(row.detail).toContain('3 properties');
  });

  it('flags hostel identity when a required field is missing', () => {
    const row = find(deriveHostelSections(source({ hostel: { name: 'X', phone: null, address: null } })), 'hostel-identity');

    expect(row.state).toBe('attention');
  });

  it('flags branding when neither logo nor colours are set', () => {
    const row = find(deriveHostelSections(source()), 'branding');

    expect(row.state).toBe('attention');
    expect(row.detail).toBe('Logo & colours not set');
  });

  it('marks branding configured once a logo exists', () => {
    const s = source();
    s.policy!.branding!.logo_url = 'https://ik.imagekit.io/logo.png';

    expect(find(deriveHostelSections(s), 'branding').state).toBe('configured');
  });

  it('flags receipt branding when the footer is empty', () => {
    const s = source();
    s.policy!.receipts!.footer = '';

    expect(find(deriveHostelSections(s), 'receipt-branding').state).toBe('attention');
  });

  it('reports real room and bed counts', () => {
    expect(find(deriveHostelSections(source()), 'room-configuration').detail).toBe('14 rooms · 137 beds');
  });

  it('does not list settings that do not exist', () => {
    // Room types and amenities have no implementation. They were rendered as
    // permanently "Not available yet" to pad a completeness meter the
    // configuration redesign removes.
    const keys = deriveHostelSections(source()).flatMap((s) => s.rows).map((r) => r.key);

    expect(keys).not.toContain('room-types');
    expect(keys).not.toContain('amenities');
  });

  it('owns agreement duration but not the deposit, so no field has two editors', () => {
    const keys = deriveHostelSections(source()).flatMap((s) => s.rows).map((r) => r.key);

    expect(keys).toContain('agreement-duration');
    expect(keys).not.toContain('security-deposit');
  });

  it('leaves no unavailable rows at all, so every row is worth a tap', () => {
    const sections = deriveHostelSections(source());
    const tally = tallyConfigRows(sections.flatMap((s) => s.rows));

    expect(allRows(sections).some((r) => r.state === 'unavailable')).toBe(false);
    expect(tally.configured + tally.attention).toBe(allRows(sections).length);
  });
});

describe('deriveFinanceSections', () => {
  it('describes rent rules from real policy values', () => {
    const row = find(deriveFinanceSections(source()), 'rent-rules');

    expect(row.detail).toBe('Generated 1st · Due on 5th · 3-day grace');
    expect(row.state).toBe('configured');
  });

  it('describes the late fee with its real amount and cadence', () => {
    expect(find(deriveFinanceSections(source()), 'late-fees').detail).toBe('₹50 / day after grace');
  });

  it('flags a late fee that is enabled but has no amount', () => {
    const s = source();
    s.policy!.billing!.late_fee = { enabled: true, rules: [{ type: 'PER_DAY' }] };

    expect(find(deriveFinanceSections(s), 'late-fees').state).toBe('attention');
  });

  it('treats late fees switched off as off, not as a gap', () => {
    const s = source();
    s.policy!.billing!.late_fee = { enabled: false, rules: [] };

    expect(find(deriveFinanceSections(s), 'late-fees').state).toBe('off');
  });

  it('describes a months-of-rent deposit without inventing an amount', () => {
    // The row is hostel-wide, so it cannot show rupees here: the amount depends
    // on each room's rent. The Deposit screen's preview is where the arithmetic
    // is shown.
    const s = source();
    s.policy!.billing!.deposit = {
      enabled: true,
      calculation_mode: 'MONTHS_OF_RENT',
      deposit_months: 2,
      refundable: true,
      default_amount: 0,
    };
    const row = find(deriveFinanceSections(s), 'security-deposit');

    expect(row.detail).toBe('2 months of rent · Refundable at move-out');
    expect(row.state).toBe('configured');
  });

  it('describes a flat deposit with its amount', () => {
    const s = source();
    s.policy!.billing!.deposit = {
      enabled: true,
      calculation_mode: 'FLAT',
      default_amount: 10000,
      refundable: false,
      deposit_months: 2,
    };
    const row = find(deriveFinanceSections(s), 'security-deposit');

    expect(row.detail).toBe('₹10,000 · Non-refundable');
    expect(row.state).toBe('configured');
  });

  it('flags a deposit switched on with nothing to collect', () => {
    // A flat deposit of ₹0 used to read as configured, because the row checked
    // deposit_months regardless of the mode.
    const s = source();
    s.policy!.billing!.deposit = { enabled: true, calculation_mode: 'FLAT', default_amount: 0, deposit_months: 2 };
    const row = find(deriveFinanceSections(s), 'security-deposit');

    expect(row.state).toBe('attention');
  });

  it('treats a deposit switched off as off, not as a gap', () => {
    const s = source();
    s.policy!.billing!.deposit = { enabled: false, calculation_mode: 'FLAT', default_amount: 0 };
    const row = find(deriveFinanceSections(s), 'security-deposit');

    expect(row.state).toBe('off');
    expect(row.detail).toBe('Not required');
  });

  it('has no "advance payments" row, since that is the same stored field as the deposit', () => {
    const keys = deriveFinanceSections(source()).flatMap((s) => s.rows).map((r) => r.key);

    expect(keys).not.toContain('advance-payments');
  });

  it('offers part payments as a real row — instalments, not the deposit', () => {
    const row = find(deriveFinanceSections(source()), 'part-payments');

    // Full-payment-only is a deliberate stance, so `off` rather than a gap.
    expect(row.state).toBe('off');
    expect(row.detail).toBe('Each due must be cleared in full');
  });

  it('reflects part payments being switched on', () => {
    const s = source();
    s.policy!.billing!.partial_payments = { enabled: true, minimum_amount: 500 };

    expect(find(deriveFinanceSections(s), 'part-payments').state).toBe('configured');
  });

  it('sends every row to its own screen rather than all to one combined form', () => {
    // The point of the split: tapping "Security deposit" must not land on the
    // same page as "Rent rules". Distinct routes are what makes each screen
    // focused — and buildBillingPatch is what keeps them from overwriting
    // each other.
    const routes = deriveFinanceSections(source())
      .flatMap((s) => s.rows)
      .filter((r) => r.state !== 'unavailable' && r.route)
      .map((r) => r.route!);

    expect(new Set(routes).size).toBe(routes.length);
    expect(routes).not.toContain('/owner/more/configuration/finance/billing-policy');
  });

  it('flags a missing GST number', () => {
    expect(find(deriveFinanceSections(source()), 'gst').state).toBe('attention');
  });

  it('marks GST configured when present', () => {
    const s = source();
    s.hostel!.gst_number = '37ABCDE1234F1Z5';

    expect(find(deriveFinanceSections(s), 'gst').state).toBe('configured');
  });

  it('does not list payment methods, which are not configuration at all', () => {
    // The screen this replaced printed "UPI · Cash · Bank transfer" from a
    // string literal; `payment_method` exists only on payment rows. Rendering
    // it as permanently unavailable was honest but useless.
    const keys = deriveFinanceSections(source()).map((s) => s.rows).flat().map((r) => r.key);

    expect(keys).not.toContain('payment-methods');
  });

  it('describes the receipt series from the real prefix and format', () => {
    expect(find(deriveFinanceSections(source()), 'receipts').detail).toContain('SRI');
  });
});

describe('room configuration row', () => {
  it('points at the hostel drilldown rooms tab, which is where rooms actually live', () => {
    const sections = deriveHostelSections(
      source({ hostel: { id: 'h-1', name: 'Sunrise Residency', city: 'Guntur' } }),
    );
    expect(find(sections, 'room-configuration').route).toBe('/owner/hostels/h-1/rooms');
  });

  it('offers no route at all when the hostel id is unknown, rather than a broken one', () => {
    // A row that navigates nowhere is worse than a row that does not invite a
    // tap: the old route `/owner/more/configuration/hostel/rooms` was never
    // registered, so tapping it did nothing and said nothing.
    const sections = deriveHostelSections(
      source({ hostel: { name: 'Sunrise Residency' } }),
    );
    expect(find(sections, 'room-configuration').route).toBeUndefined();
  });
});
