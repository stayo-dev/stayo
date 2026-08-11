import { describe, it, expect } from 'vitest';
import {
  computeMoveInTotal,
  deriveInvitationProgress,
  describeExpiry,
  diffTerms,
  missingTerms,
  relativeDayLabel,
  type DraftTerms,
} from './invitationWorkspace';

const NOW = new Date('2026-08-11T10:00:00.000Z').getTime();
const days = (n: number) => new Date(NOW + n * 86_400_000).toISOString();

describe('relativeDayLabel', () => {
  it('names today, tomorrow and yesterday instead of "0 days"', () => {
    expect(relativeDayLabel(days(0), NOW)).toBe('today');
    expect(relativeDayLabel(days(1), NOW)).toBe('tomorrow');
    expect(relativeDayLabel(days(-1), NOW)).toBe('yesterday');
  });

  it('counts days in both directions', () => {
    expect(relativeDayLabel(days(-4), NOW)).toBe('4 days ago');
    expect(relativeDayLabel(days(3), NOW)).toBe('in 3 days');
  });

  it('returns null for missing or unparseable input', () => {
    expect(relativeDayLabel(null, NOW)).toBeNull();
    expect(relativeDayLabel('not-a-date', NOW)).toBeNull();
  });
});

describe('describeExpiry', () => {
  it('reads the real deadline rather than assuming a fixed window', () => {
    expect(describeExpiry(days(5), NOW)).toMatchObject({ label: 'Expires in 5 days', tone: 'ok', daysLeft: 5 });
  });

  it('escalates tone as the deadline approaches', () => {
    expect(describeExpiry(days(2), NOW).tone).toBe('warning');
    expect(describeExpiry(days(0.5), NOW)).toMatchObject({ label: 'Expires tomorrow', tone: 'warning' });
    expect(describeExpiry(days(-0.5), NOW)).toMatchObject({ label: 'Expires today', tone: 'danger' });
  });

  it('flags an expired link', () => {
    expect(describeExpiry(days(-3), NOW)).toMatchObject({ label: 'Link expired', tone: 'danger', isExpired: true });
  });

  it('does not fabricate a deadline when none is set', () => {
    expect(describeExpiry(null, NOW)).toMatchObject({ label: 'No expiry set', isExpired: false, daysLeft: null });
  });
});

describe('deriveInvitationProgress', () => {
  it('reports "not opened" for a fresh PENDING invitation', () => {
    const p = deriveInvitationProgress({ status: 'PENDING', sent_at: days(-0.2), expires_at: days(7) }, NOW);
    expect(p.headline).toBe('Waiting for the tenant to open the link');
    expect(p.steps.map((s) => s.state)).toEqual(['done', 'current', 'todo', 'todo']);
    expect(p.needsNudge).toBe(false);
  });

  it('suggests a nudge once an unopened invitation is over a day old', () => {
    const p = deriveInvitationProgress({ status: 'PENDING', sent_at: days(-3), expires_at: days(4) }, NOW);
    expect(p.needsNudge).toBe(true);
  });

  it('distinguishes opened from merely sent', () => {
    const p = deriveInvitationProgress(
      { status: 'OPENED', sent_at: days(-3), opened_at: days(-1), expires_at: days(4) },
      NOW,
    );
    expect(p.headline).toBe('Tenant opened the link');
    expect(p.steps[1]).toMatchObject({ key: 'OPENED', state: 'done', at: 'yesterday' });
    expect(p.steps[2].state).toBe('current');
  });

  it('recognises a tenant mid-registration', () => {
    const p = deriveInvitationProgress(
      { status: 'ACTIVATION_STARTED', sent_at: days(-4), opened_at: days(-2), activation_started_at: days(-1), expires_at: days(3) },
      NOW,
    );
    expect(p.headline).toBe('Tenant is creating their account');
    expect(p.steps[2].state).toBe('done');
    expect(p.needsNudge).toBe(false);
  });

  it('lets expiry override an un-actioned invitation', () => {
    const p = deriveInvitationProgress({ status: 'PENDING', sent_at: days(-9), expires_at: days(-2) }, NOW);
    expect(p.headline).toBe('Invitation link expired');
    expect(p.needsNudge).toBe(true);
  });

  it('does not chase a cancelled invitation', () => {
    const p = deriveInvitationProgress({ status: 'CANCELLED', sent_at: days(-5), expires_at: days(-1) }, NOW);
    expect(p.headline).toBe('Invitation cancelled');
    expect(p.needsNudge).toBe(false);
  });

  it('falls back to a sane timeline when there is no invitation row', () => {
    const p = deriveInvitationProgress(null, NOW);
    expect(p.steps).toHaveLength(4);
    expect(p.headline).toBe('Waiting for the tenant to open the link');
  });
});

describe('computeMoveInTotal', () => {
  const base = { monthlyRent: 8000, deposit: 16000, maintenanceCharge: 1000 };

  it('counts one-time maintenance as due at move-in', () => {
    expect(computeMoveInTotal({ ...base, maintenanceType: 'ONE_TIME' })).toBe(25000);
  });

  it('excludes recurring maintenance from the move-in total', () => {
    expect(computeMoveInTotal({ ...base, maintenanceType: 'MONTHLY' })).toBe(24000);
    expect(computeMoveInTotal({ ...base, maintenanceType: 'NONE' })).toBe(24000);
  });
});

const terms = (over: Partial<DraftTerms> = {}): DraftTerms => ({
  name: 'Loucs',
  phone: '9391242359',
  email: '',
  hostelId: 'h1',
  roomId: 'r1',
  roomLabel: '12-A',
  joiningDate: '2026-08-15',
  paymentFrequency: 'MONTHLY',
  monthlyRent: 8000,
  deposit: 16000,
  maintenanceCharge: 0,
  maintenanceType: 'NONE',
  agreementStartDate: '2026-08-15',
  agreementDurationMonths: 11,
  ...over,
});

describe('diffTerms', () => {
  it('finds nothing when the draft is untouched', () => {
    expect(diffTerms(terms(), terms())).toEqual([]);
  });

  it('names each change with its before and after', () => {
    const changes = diffTerms(terms(), terms({ monthlyRent: 9500 }));
    expect(changes).toEqual([
      { field: 'monthlyRent', label: 'Monthly rent', from: '₹8,000', to: '₹9,500', isFinancial: true },
    ]);
  });

  it('renders a room change by its label, not its id', () => {
    const changes = diffTerms(terms(), terms({ roomId: 'r2', roomLabel: '14-B' }));
    expect(changes[0]).toMatchObject({ label: 'Room', from: '12-A', to: '14-B' });
  });

  it('separates contact edits from terms edits', () => {
    const changes = diffTerms(terms(), terms({ name: 'Lucas', deposit: 18000 }));
    expect(changes.find((c) => c.field === 'name')?.isFinancial).toBe(false);
    expect(changes.find((c) => c.field === 'deposit')?.isFinancial).toBe(true);
  });

  it('treats a stored +91 number and the same number typed locally as unchanged', () => {
    expect(diffTerms(terms({ phone: '+919391242359' }), terms({ phone: '9391242359' }))).toEqual([]);
  });

  it('shows a real phone change without doubling the country code', () => {
    const changes = diffTerms(terms({ phone: '+919391242359' }), terms({ phone: '+918008046952' }));
    expect(changes).toEqual([
      { field: 'phone', label: 'Phone', from: '+91 93912 42359', to: '+91 80080 46952', isFinancial: false },
    ]);
  });

  it('does not report a change for equivalent numeric spellings', () => {
    expect(diffTerms(terms({ monthlyRent: 8000 }), terms({ monthlyRent: 8000.0 }))).toEqual([]);
  });

  it('ignores surrounding whitespace on text fields', () => {
    expect(diffTerms(terms(), terms({ name: '  Loucs  ' }))).toEqual([]);
  });
});

describe('missingTerms', () => {
  it('is empty for a fully configured invitation', () => {
    expect(missingTerms(terms())).toEqual([]);
  });

  it('does not claim a room is unassigned when one is set', () => {
    expect(missingTerms(terms()).some((m) => m.field === 'roomId')).toBe(false);
  });

  it('reports each gap with the field it should jump to', () => {
    const missing = missingTerms(terms({ roomId: '', monthlyRent: 0 }));
    expect(missing.map((m) => m.field)).toEqual(['roomId', 'monthlyRent']);
  });
});
