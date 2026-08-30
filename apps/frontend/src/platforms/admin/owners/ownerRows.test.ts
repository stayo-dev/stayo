import { describe, it, expect } from 'vitest';
import { toOwnerRows, ownerStats, formatInr } from './ownerRows';

const api = [
  {
    id: 'o1', name: 'Sunrise Residency', city: 'Guntur', hostels: 3, beds: 137,
    monthly_revenue: 820000, plan: 'Pro', is_active: true,
  },
  {
    id: 'o2', name: 'Coliv Spaces', city: null, hostels: 0, beds: 0,
    monthly_revenue: 0, plan: null, is_active: false,
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
