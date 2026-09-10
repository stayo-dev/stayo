import { describe, it, expect } from 'vitest';
import { hubGroups } from './hubSections';

describe('hubGroups', () => {
  it('holds the owner\'s own account and nothing else', () => {
    expect(hubGroups().map((g) => g.label)).toEqual(['Account', 'Support']);
  });

  it('labels every row with a single keyword', () => {
    // The heading carries the context, so the row only has to carry the noun.
    for (const row of hubGroups().flatMap((g) => g.rows)) {
      expect(row.label.split(/\s+/)).toHaveLength(1);
      expect(row.label).toBe(row.label.trim());
    }
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

  it('links to exactly the four screens an owner\'s account has', () => {
    expect(hubGroups().flatMap((g) => g.rows).map((r) => r.route)).toEqual([
      '/owner/more/profile',
      '/owner/more/password',
      '/owner/more/payout-account',
      '/owner/more/help',
    ]);
  });

  it('needs no hostel to be correct', () => {
    // The load-bearing property of this screen. Every row that had to know
    // which hostel it meant — notices, the hostel identity warnings, every
    // search result — now lives on the hostel that owns it. Nothing left here
    // can pick the wrong one, because nothing left here picks at all.
    const routes = hubGroups().flatMap((g) => g.rows).map((r) => r.route);
    for (const route of routes) {
      expect(route).not.toContain('hostel');
      expect(route).not.toContain('hostelId');
    }
  });

  it('no longer offers a second door to screens that moved', () => {
    // Notices belongs to a hostel; Requests is `/owner/alerts/requests`, which
    // has search, tenant chat and notification deep-links this one never did;
    // About was three links and a mocked version string, now the foot of Help.
    const routes = hubGroups().flatMap((g) => g.rows).map((r) => r.route);
    expect(routes).not.toContain('/owner/more/notices');
    expect(routes).not.toContain('/owner/more/service-requests');
    expect(routes).not.toContain('/owner/more/about');
  });

  it('has no duplicate rows or routes', () => {
    const rows = hubGroups().flatMap((g) => g.rows);
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length);
    expect(new Set(rows.map((r) => r.route)).size).toBe(rows.length);
  });

  it('offers the two things an owner could not do at all before', () => {
    // Both APIs were built and had zero callers: an owner could not change
    // their password, and could not tell Stayo which bank to pay them into.
    const routes = hubGroups().flatMap((g) => g.rows).map((r) => r.route);
    expect(routes).toContain('/owner/more/password');
    expect(routes).toContain('/owner/more/payout-account');
  });

  it('stays short enough to read without scrolling', () => {
    expect(hubGroups().flatMap((g) => g.rows).length).toBeLessThanOrEqual(6);
  });
});

describe('the merged settings screens', () => {
  it('no longer routes anyone to a menu of menus', () => {
    // Three screens — the hub, "Settings" and "Account & security" — led back
    // into each other's destinations. An owner had to know which of the three
    // held a row. Both extra menus are deleted.
    const routes = hubGroups().flatMap((g) => g.rows).map((r) => r.route);
    expect(routes).not.toContain('/owner/more/settings');
    expect(routes.some((r) => r.startsWith('/owner/more/configuration'))).toBe(false);
  });
});
