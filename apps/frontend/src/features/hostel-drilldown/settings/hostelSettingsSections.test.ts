import { describe, it, expect } from 'vitest';
import { hostelSettingsGroups } from './hostelSettingsSections';

const groups = () => hostelSettingsGroups('h-1');

describe('hostelSettingsGroups', () => {
  it("groups by the owner's question, not by the policy object", () => {
    // `billing`, `reminders` and `automation` each feed more than one group.
    // An owner does not know which object holds which field.
    expect(groups().map((g) => g.label)).toEqual([
      'Hostel',
      'Rent & money',
      'Tenants',
      'Messages',
    ]);
  });

  it('does not list receipts, which are set once and never revisited', () => {
    expect(groups().flatMap((g) => g.rows).some((r) => r.key === 'receipts')).toBe(false);
  });

  it('does not list rooms, which are the tab next door', () => {
    // Rooms sit immediately left of Settings in the same tab row. A row here
    // was a second door to a screen already one tap away.
    expect(groups().flatMap((g) => g.rows).some((r) => r.key === 'rooms')).toBe(false);
  });

  it('labels a row with a keyword and explains it underneath', () => {
    // A column of full sentences has to be read line by line; one-word labels
    // are found at a glance, and the sentence still does its work in the hint.
    for (const row of groups().flatMap((g) => g.rows)) {
      expect(row.label.split(' ').length).toBeLessThanOrEqual(2);
      expect(row.hint.length).toBeGreaterThan(row.label.length);
    }
  });

  it('gives every row a label and a hint, so no row is a bare noun', () => {
    // "Rent rules" tells an owner nothing. The hint is what makes a row
    // answerable without opening it.
    for (const row of groups().flatMap((g) => g.rows)) {
      expect(row.label.length).toBeGreaterThan(0);
      expect(row.hint.length).toBeGreaterThan(0);
      expect(row.label).not.toBe(row.hint);
    }
  });

  it('carries every setting that used to live in the Configure section', () => {
    // Configure no longer has a hostel section, so anything missing here is
    // unreachable rather than merely moved.
    const routes = groups().flatMap((g) => g.rows).map((r) => r.route.split('?')[0]);
    for (const moved of [
      '/owner/more/hostel',
      '/owner/more/configuration/finance/rent-schedule',
      '/owner/more/configuration/finance/late-fees',
      '/owner/more/configuration/finance/part-payments',
      '/owner/more/configuration/finance/deposit',
      '/owner/more/configuration/hostel/tenant-defaults',
      '/owner/more/configuration/agreements',
      '/owner/more/configuration/notifications',
      '/owner/more/configuration/automation',
    ]) {
      expect(routes).toContain(moved);
    }
  });

  it('tells every configuration screen which hostel it is editing', () => {
    // Those screens all fell back to the owner's primary hostel. Without this
    // query, opening a second hostel's Settings and changing its late fee
    // edited the first hostel's — with the second hostel's name in the header.
    for (const row of groups().flatMap((g) => g.rows)) {
      const scoped = row.route.includes('/owner/hostels/h-1/') || row.route.includes('hostelId=h-1');
      expect(scoped).toBe(true);
    }
  });

  it('has no duplicate rows', () => {
    const rows = groups().flatMap((g) => g.rows);
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length);
    expect(new Set(rows.map((r) => r.route)).size).toBe(rows.length);
  });
});
