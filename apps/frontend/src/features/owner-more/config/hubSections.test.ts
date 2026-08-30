import { describe, it, expect } from 'vitest';
import { hubGroups, visibleAttention, MAX_ATTENTION_ROWS } from './hubSections';

describe('hubGroups', () => {
  it('groups every destination under a heading in the owner\'s words', () => {
    const groups = hubGroups();
    expect(groups.map((g) => g.label)).toEqual(['Your account', 'Support']);
  });

  it('carries a label and a route per row, and nothing else', () => {
    // The badges, subtitles and area counts are what made each row three lines
    // tall. A row's whole job is to say where it goes.
    for (const row of hubGroups().flatMap((g) => g.rows)) {
      expect(Object.keys(row).sort()).toEqual(['key', 'label', 'route']);
      expect(row.label.length).toBeGreaterThan(0);
      expect(row.route.startsWith('/owner/')).toBe(true);
    }
  });

  it('holds nothing about a hostel — those live on the hostel itself', () => {
    // Hostels are managed from Home. A second hostel section here made an
    // owner guess which of two places a setting lived in, and let a
    // multi-hostel owner edit the wrong hostel's rules. See
    // hostelSettingsSections, which now owns all of these.
    const routes = hubGroups().flatMap((g) => g.rows).map((r) => r.route);
    for (const moved of [
      '/owner/more/hostel',
      '/owner/more/configuration/finance',
      '/owner/more/configuration/agreements',
      '/owner/more/configuration/notifications',
      '/owner/more/configuration/automation',
    ]) {
      expect(routes).not.toContain(moved);
    }
    // Account and security is owner-level and stays.
    expect(routes).toContain('/owner/more/configuration/account');
  });

  it('has no duplicate rows or routes', () => {
    // Quick actions used to repeat three destinations that were already listed
    // directly beneath them.
    const rows = hubGroups().flatMap((g) => g.rows);
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length);
    expect(new Set(rows.map((r) => r.route)).size).toBe(rows.length);
  });

  it('stays short enough to read without scrolling past furniture', () => {
    expect(hubGroups().flatMap((g) => g.rows).length).toBeLessThanOrEqual(12);
  });
});

describe('visibleAttention', () => {
  it('shows what genuinely needs attention', () => {
    const items = [{ title: 'GST number not added', sub: 'Hostel', route: '/x' }];
    expect(visibleAttention(items)).toHaveLength(1);
  });

  it('caps the list rather than rebuilding the wall of blocks', () => {
    const items = Array.from({ length: 6 }, (_, i) => ({ title: `t${i}`, sub: 's', route: '/x' }));
    expect(visibleAttention(items)).toHaveLength(MAX_ATTENTION_ROWS);
  });

  it('survives an empty or missing list', () => {
    expect(visibleAttention([])).toEqual([]);
    expect(visibleAttention(undefined)).toEqual([]);
  });
});
