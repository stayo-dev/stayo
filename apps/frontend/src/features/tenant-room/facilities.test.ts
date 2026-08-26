import { describe, expect, it } from 'vitest';
import { buildTenantFacilities, iconForLabel, wifiCredentialLine } from './facilities';
import { describeAvailability } from '@shared/lib/amenityAvailability';

const room = { wifi_name: 'SriAdithya_5G', wifi_password: 'hostel@2026' };

describe('choosing a glyph', () => {
  // The old list gave every row the Wi-Fi icon, which is why Hot water and
  // Laundry rendered with a wifi glyph.
  it('reads the owner’s own words rather than requiring a fixed vocabulary', () => {
    expect(iconForLabel('Wi-Fi')).toBe('wifi');
    expect(iconForLabel('Hot water')).toBe('hot-water');
    expect(iconForLabel('Geyser in bathroom')).toBe('hot-water');
    expect(iconForLabel('Drinking water')).toBe('water');
    expect(iconForLabel('Laundry')).toBe('laundry');
    expect(iconForLabel('Housekeeping')).toBe('cleaning');
    expect(iconForLabel('Power backup')).toBe('power');
    expect(iconForLabel('Attached bathroom')).toBe('bathroom');
    expect(iconForLabel('CCTV')).toBe('security');
  });

  it('prefers hot water over plain water when both words appear', () => {
    expect(iconForLabel('Hot water 24x7')).toBe('hot-water');
  });

  it('honours an explicit icon key when the owner set one', () => {
    expect(iconForLabel('Anything', 'laundry')).toBe('laundry');
  });

  it('falls back rather than guessing wrongly', () => {
    expect(iconForLabel('Terrace access')).toBe('generic');
    expect(iconForLabel('Anything', 'not-a-real-icon')).toBe('generic');
  });
});

describe('building the tenant list', () => {
  it('shows timings as a scannable pill', () => {
    const rows = buildTenantFacilities({
      amenities: [
        {
          label: 'Hot water',
          enabled: true,
          availability: 'HOURS',
          // Picked from the dial, stored as 24-hour blocks.
          availabilitySlots: [
            { start: '06:00', end: '10:00' },
            { start: '18:00', end: '22:00' },
          ],
        },
      ],
      room: null,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ label: 'Hot water', schedule: '6–10 AM · 6–10 PM', detail: null, icon: 'hot-water' });
  });

  // "Runs whenever the power goes off" is not a time range and never will be,
  // so it goes on its own line rather than into a badge.
  it('shows a note on its own line rather than in a pill', () => {
    const rows = buildTenantFacilities({
      amenities: [{ label: 'Power backup', enabled: true, availability: 'NOTE', availabilityValue: 'Runs whenever the power goes off' }],
      room: null,
    });
    expect(rows[0]).toMatchObject({ detail: 'Runs whenever the power goes off', schedule: null, icon: 'power' });
  });

  it('shows 24×7 without the owner typing it', () => {
    const rows = buildTenantFacilities({ amenities: [{ label: 'RO water', enabled: true, availability: 'ALWAYS' }], room: null });
    expect(rows[0].schedule).toBe('24×7');
  });

  // The commonest case: the chip already says "CCTV security".
  it('renders the label alone when the owner added nothing', () => {
    const rows = buildTenantFacilities({ amenities: [{ label: 'CCTV security', enabled: true }], room: null });
    expect(rows[0]).toMatchObject({ label: 'CCTV security', detail: null, schedule: null });
  });

  it('drops disabled and unnamed amenities', () => {
    const rows = buildTenantFacilities({
      amenities: [
        { label: 'Laundry', enabled: false },
        { label: '   ', enabled: true },
        { label: 'Power backup', enabled: true },
      ],
      room: null,
    });
    expect(rows.map((r) => r.label)).toEqual(['Power backup']);
  });

  it('treats a missing enabled flag as enabled, so older revisions still render', () => {
    expect(buildTenantFacilities({ amenities: [{ label: 'Laundry' }], room: null })).toHaveLength(1);
  });

  it('attaches the room credentials to the Wi-Fi row', () => {
    const rows = buildTenantFacilities({ amenities: [{ label: 'Wi-Fi', enabled: true }], room });
    expect(rows[0].wifi).toEqual({ ssid: 'SriAdithya_5G', password: 'hostel@2026' });
  });

  // The tenant needs the password. Its absence from a marketing list is not a
  // reason to withhold it.
  it('adds a Wi-Fi row when the owner never listed it but the room has credentials', () => {
    const rows = buildTenantFacilities({ amenities: [{ label: 'Laundry', enabled: true }], room });
    expect(rows[0].label).toBe('Wi-Fi');
    expect(rows[0].wifi?.ssid).toBe('SriAdithya_5G');
  });

  it('does not invent a Wi-Fi row when there are no credentials either', () => {
    const rows = buildTenantFacilities({ amenities: [{ label: 'Laundry', enabled: true }], room: null });
    expect(rows.map((r) => r.label)).toEqual(['Laundry']);
  });

  it('renders nothing at all when the owner has listed nothing', () => {
    // Better an absent section than six invented rows, which is what it did.
    expect(buildTenantFacilities({ amenities: [], room: null })).toEqual([]);
    expect(buildTenantFacilities({ amenities: null, room: null })).toEqual([]);
  });

  it('drops a kind that needs a value but has none, rather than showing an empty pill', () => {
    const rows = buildTenantFacilities({ amenities: [{ label: 'Laundry', availability: 'HOURS', availabilitySlots: [] }], room: null });
    expect(rows[0].detail).toBeNull();
    expect(rows[0].schedule).toBeNull();
  });
});

describe('the Wi-Fi credential lines', () => {
  it('shows the credentials once an owner has set them', () => {
    expect(wifiCredentialLine({ ssid: 'SriAdithya_5G', password: 'hostel@2026' })).toEqual({
      ssid: 'SriAdithya_5G',
      password: 'hostel@2026',
      configured: true,
    });
  });

  // 0 of 70 production rooms had a wifi name when this was written, so this is
  // the path nearly every tenant sees.
  it('tells the tenant what to do instead, and does not imply the network is down', () => {
    const line = wifiCredentialLine(undefined);
    expect(line.ssid).toBe('Ask the front desk');
    expect(line.password).toBe('Ask the front desk');
    expect(line.configured).toBe(false);
  });

  it('counts as configured when only one of the two is set', () => {
    expect(wifiCredentialLine({ ssid: 'SriAdithya_5G', password: null }).configured).toBe(true);
  });
});

describe('the tenant Room tab and the Discovery listing cannot drift', () => {
  /**
   * Both surfaces render from the *same* `describeAvailability` projection over
   * the *same* approved revision. This pins that: if one is ever taught to read
   * the amenity directly, these stop agreeing and this fails.
   */
  const cases = [
    {
      label: '3 meals / day',
      enabled: true,
      availability: 'HOURS' as const,
      availabilitySlots: [
        { start: '07:00', end: '09:00' },
        { start: '12:00', end: '14:00' },
        { start: '19:00', end: '20:30' },
      ],
    },
    { label: 'Power backup', enabled: true, availability: 'NOTE' as const, availabilityValue: 'Runs whenever the power goes off' },
    { label: 'CCTV security', enabled: true, availability: 'ALWAYS' as const },
    { label: 'Parking', enabled: true },
  ];

  it.each(cases.map((amenity) => [amenity.label, amenity] as const))(
    '%s reads identically on both surfaces',
    (_label, amenity) => {
      const listing = describeAvailability(amenity);
      const [tenant] = buildTenantFacilities({ amenities: [amenity], room: null });

      expect(tenant.schedule).toBe(listing.pill);
      expect(tenant.detail).toBe(listing.line);
    },
  );

  it('renders the real production timings the way the owner set them', () => {
    // The slots saved from the dial for Sri Adithya's three meals.
    const [row] = buildTenantFacilities({ amenities: [cases[0]], room: null });
    expect(row.schedule).toBe('7–9 AM · 12–2 PM · 7–8:30 PM');
  });
});
