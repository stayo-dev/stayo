import { describe, it, expect } from 'vitest';
import { toOwnerRows, ownerStats, formatInr } from './ownerRows';

// Field names match the real `/platform-admin/owners` response shape
// (route.ts): `capacity`, `collected_this_month`, `plan_name` — not the
// `beds`/`monthly_revenue`/`plan` names this fixture used to use, which
// silently mapped to `undefined` on every real request and always showed
// 0 beds / ₹0 GMV / "Unassigned" regardless of the actual owner.
const api = [
  {
    id: 'o1', name: 'Sunrise Residency', city: 'Guntur', hostels: 3, capacity: 137,
    collected_this_month: 820000, plan_name: 'Pro', is_active: true,
    photo_url: 'https://ik.imagekit.io/stayo/owners/o1-photo.jpg',
  },
  {
    id: 'o2', name: 'Coliv Spaces', city: null, hostels: 0, capacity: 0,
    collected_this_month: 0, plan_name: null, is_active: false, photo_url: null,
  },
];

describe('formatInr', () => {
  it('uses lakh notation at and above one lakh', () => {
    expect(formatInr(820000)).toBe('₹8.2L');
    expect(formatInr(100000)).toBe('₹1.0L');
  });

  it('uses plain Indian grouping below one lakh', () => {
    expect(formatInr(42000)).toBe('₹42,000');
  });

  it('renders zero as ₹0, not as an em dash — zero revenue is a real fact', () => {
    expect(formatInr(0)).toBe('₹0');
  });
});

describe('toOwnerRows', () => {
  it('derives two-letter initials from the owner name', () => {
    expect(toOwnerRows(api)[0].initials).toBe('SR');
  });

  it('formats GMV in Indian lakh notation', () => {
    expect(toOwnerRows(api)[0].gmv).toBe('₹8.2L');
  });

  it('falls back to an em dash rather than inventing a city', () => {
    expect(toOwnerRows(api)[1].city).toBe('—');
  });

  it('shows no plan as Unassigned rather than blank', () => {
    expect(toOwnerRows(api)[1].plan).toBe('Unassigned');
  });

  it('maps is_active to a status label and tone', () => {
    const rows = toOwnerRows(api);
    expect(rows[0].status).toBe('Active');
    expect(rows[0].statusTone).toBe('green');
    expect(rows[1].status).toBe('Paused');
    expect(rows[1].statusTone).toBe('muted');
  });

  it('assigns a tint from the id, so a row keeps its colour across refetches', () => {
    expect(toOwnerRows(api)[0].tint).toBe(toOwnerRows(api)[0].tint);
    expect(toOwnerRows(api)[0].tint).toMatch(/^#[0-9A-F]{6}$/i);
  });

  it('tolerates an empty list', () => {
    expect(toOwnerRows([])).toEqual([]);
  });

  it('carries the uploaded photo through when the owner has one', () => {
    expect(toOwnerRows(api)[0].photoUrl).toBe('https://ik.imagekit.io/stayo/owners/o1-photo.jpg');
  });

  it('falls back to null (not a broken image) when no photo was uploaded', () => {
    expect(toOwnerRows(api)[1].photoUrl).toBeNull();
  });
});

describe('ownerStats', () => {
  it('totals owners, hostels and beds across the page', () => {
    const stats = ownerStats(toOwnerRows(api));
    expect(stats.find((s) => s.label === 'Total owners')?.value).toBe('2');
    expect(stats.find((s) => s.label === 'Hostels')?.value).toBe('3');
    expect(stats.find((s) => s.label === 'Beds')?.value).toBe('137');
  });

  it('counts only active owners as active', () => {
    const stats = ownerStats(toOwnerRows(api));
    expect(stats.find((s) => s.label === 'Active')?.value).toBe('1');
  });
});
