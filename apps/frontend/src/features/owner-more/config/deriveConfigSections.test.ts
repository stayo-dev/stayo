import { describe, expect, it } from 'vitest';
import { deriveFinanceSections, deriveHostelSections, ordinalDay, type ConfigSource } from './deriveConfigSections';
import { tallyConfigRows } from './configRows';

const source = (overrides: Partial<ConfigSource> = {}): ConfigSource => ({
  hostel: { name: 'Sri Adithya Hostels', phone: '9876543210', address: '12 Main Rd', city: 'Guntur', gst_number: null },
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
    expect(row.detail).toContain('Sri Adithya Hostels');
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

  it('renders room types and amenities as unavailable, not as gaps', () => {
    const sections = deriveHostelSections(source());

    expect(find(sections, 'room-types').state).toBe('unavailable');
    expect(find(sections, 'amenities').state).toBe('unavailable');
  });

  it('keeps unavailable rows out of the area tally', () => {
    const sections = deriveHostelSections(source());
    const tally = tallyConfigRows(sections.flatMap((s) => s.rows));
    const realRows = sections.flatMap((s) => s.rows).filter((r) => r.state !== 'unavailable');

    expect(tally.configured + tally.attention).toBeLessThanOrEqual(realRows.length);
    expect(allRows(sections).some((r) => r.state === 'unavailable')).toBe(true);
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

  it('describes the security deposit from the nested deposit policy', () => {
    const row = find(deriveFinanceSections(source()), 'security-deposit');

    expect(row.detail).toBe('1 month · Refundable at move-out');
    expect(row.state).toBe('configured');
  });

  it('renders advance payments as unavailable, because it is the same field as the deposit', () => {
    // The mockup lists "Security deposit" and "Advance payments" as separate
    // rows, but this data model has one deposit concept: the flat legacy
    // `advance_enabled`/`advance_amount_default`/`advance_refundable` fields
    // are the nested `billing.deposit` object. Showing both as editable would
    // give an owner two controls over one value.
    const row = find(deriveFinanceSections(source()), 'advance-payments');

    expect(row.state).toBe('unavailable');
  });

  it('flags a missing GST number', () => {
    expect(find(deriveFinanceSections(source()), 'gst').state).toBe('attention');
  });

  it('marks GST configured when present', () => {
    const s = source();
    s.hostel!.gst_number = '37ABCDE1234F1Z5';

    expect(find(deriveFinanceSections(s), 'gst').state).toBe('configured');
  });

  it('renders payment methods as unavailable rather than the hardcoded list it replaces', () => {
    // The screen this replaces printed "UPI · Cash · Bank transfer" from a
    // string literal; `payment_method` exists only on payment rows, never as
    // configuration.
    const row = find(deriveFinanceSections(source()), 'payment-methods');

    expect(row.state).toBe('unavailable');
    expect(row.detail).not.toContain('UPI');
  });

  it('describes the receipt series from the real prefix and format', () => {
    expect(find(deriveFinanceSections(source()), 'receipts').detail).toContain('SRI');
  });
});
