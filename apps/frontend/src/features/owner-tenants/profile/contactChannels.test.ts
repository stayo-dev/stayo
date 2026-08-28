import { describe, expect, it } from 'vitest';
import { toContactRows } from './contactChannels';

/**
 * Who the owner can reach, and how.
 *
 * The live profile rendered four icons as `<span>`s with no handlers and no
 * data behind them — a Communication Center nobody could tap. This module
 * decides which rows exist and which controls each row genuinely offers, so a
 * control can never be rendered for a number that isn't there.
 */

function overview(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Valurothu Sharan',
    phone: '+919542474944',
    guardian_name: 'Shatab',
    guardian_phone: '+919392886797',
    guardian_relation: 'Guardian',
    ...overrides,
  };
}

describe('toContactRows', () => {
  it('always offers the tenant row', () => {
    const rows = toContactRows(overview());
    expect(rows[0]).toMatchObject({
      kind: 'tenant',
      label: 'Tenant',
      name: 'Valurothu Sharan',
      phone: '+919542474944',
    });
  });

  it('offers call, whatsapp and copy when a number is present', () => {
    const [tenant] = toContactRows(overview());
    expect(tenant.channels).toEqual(['call', 'whatsapp', 'copy']);
  });

  it('offers no phone channels when the number is missing', () => {
    const [tenant] = toContactRows(overview({ phone: '' }));
    expect(tenant.channels).toEqual([]);
  });

  it('treats the literal "N/A" as a missing number', () => {
    const [tenant] = toContactRows(overview({ phone: 'N/A' }));
    expect(tenant.channels).toEqual([]);
  });

  it('includes the guardian row with its relation', () => {
    const rows = toContactRows(overview());
    expect(rows[1]).toMatchObject({
      kind: 'guardian',
      label: 'Guardian',
      name: 'Shatab',
      relation: 'Guardian',
      phone: '+919392886797',
    });
  });

  it('omits the guardian row when no guardian phone is recorded', () => {
    const rows = toContactRows(overview({ guardian_phone: '' }));
    expect(rows.map((r) => r.kind)).toEqual(['tenant']);
  });

  it('includes an emergency row from phone_3', () => {
    const rows = toContactRows(overview({ phone_3: '+919000000001' }));
    expect(rows[2]).toMatchObject({
      kind: 'emergency',
      label: 'Emergency contact',
      phone: '+919000000001',
    });
  });

  it('falls back to profile.emergency_contact when phone_3 is absent', () => {
    const rows = toContactRows(
      overview({ profile: { emergency_contact: '+919000000002' } }),
    );
    expect(rows[2]).toMatchObject({ kind: 'emergency', phone: '+919000000002' });
  });

  it('prefers phone_3 over profile.emergency_contact when both are present', () => {
    const rows = toContactRows(
      overview({ phone_3: '+919000000001', profile: { emergency_contact: '+919000000002' } }),
    );
    expect(rows[2].phone).toBe('+919000000001');
  });

  it('omits the emergency row entirely when neither source has a number', () => {
    const rows = toContactRows(overview());
    expect(rows.map((r) => r.kind)).toEqual(['tenant', 'guardian']);
  });

  it('omits the emergency row when it only repeats the guardian number', () => {
    const rows = toContactRows(overview({ phone_3: '+919392886797' }));
    expect(rows.map((r) => r.kind)).toEqual(['tenant', 'guardian']);
  });

  it('ignores formatting differences when deduplicating against the guardian', () => {
    const rows = toContactRows(overview({ phone_3: '+91 93928 86797' }));
    expect(rows.map((r) => r.kind)).toEqual(['tenant', 'guardian']);
  });

  it('omits the emergency row when it only repeats the tenant number', () => {
    const rows = toContactRows(overview({ phone_3: '+919542474944' }));
    expect(rows.map((r) => r.kind)).toEqual(['tenant', 'guardian']);
  });

  it('marks the tenant row verified when the profile phone is verified', () => {
    const [tenant] = toContactRows(overview({ profile: { phone_verified: true } }));
    expect(tenant.verified).toBe(true);
  });

  it('does not mark the tenant row verified by default', () => {
    const [tenant] = toContactRows(overview());
    expect(tenant.verified).toBe(false);
  });

  it('never marks a guardian or emergency number verified', () => {
    const rows = toContactRows(
      overview({ phone_3: '+919000000001', profile: { phone_verified: true } }),
    );
    expect(rows[1].verified).toBe(false);
    expect(rows[2].verified).toBe(false);
  });

  it('names an unnamed guardian without inventing one', () => {
    const rows = toContactRows(overview({ guardian_name: '' }));
    expect(rows[1].name).toBe('Guardian');
  });

  it('falls back to a neutral tenant name rather than rendering blank', () => {
    const [tenant] = toContactRows(overview({ name: '' }));
    expect(tenant.name).toBe('Tenant');
  });
});
