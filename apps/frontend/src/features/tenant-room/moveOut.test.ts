import { describe, expect, it } from 'vitest';
import { MOVE_OUT_REASONS, moveOutConsequences, todayISO, validateMoveOut } from './moveOut';

const base = { reason: 'COURSE_COMPLETED', reasonText: '', plannedExitDate: '2026-09-30', today: '2026-08-26' };

describe('today, in local time', () => {
  // toISOString() is UTC and would roll the date over for anyone east of
  // Greenwich after 05:30 — which is every user of this product.
  it('uses local parts rather than UTC', () => {
    expect(todayISO(new Date(2026, 7, 26, 23, 30))).toBe('2026-08-26');
    expect(todayISO(new Date(2026, 0, 1, 0, 5))).toBe('2026-01-01');
  });
});

describe('what a request needs before it can be sent', () => {
  it('accepts a complete one', () => {
    expect(validateMoveOut(base)).toEqual({ ok: true, message: '' });
  });

  it('needs a reason, so the hostel knows what to do about it', () => {
    expect(validateMoveOut({ ...base, reason: '' }).ok).toBe(false);
  });

  // An owner receiving OTHER with no text has been told nothing at all.
  it('asks for a sentence when the reason is "something else"', () => {
    expect(validateMoveOut({ ...base, reason: 'OTHER', reasonText: '   ' }).ok).toBe(false);
    expect(validateMoveOut({ ...base, reason: 'OTHER', reasonText: 'Family moving city' }).ok).toBe(true);
  });

  it('needs a date', () => {
    expect(validateMoveOut({ ...base, plannedExitDate: '' }).ok).toBe(false);
  });

  it('refuses a date already gone, which is a typo rather than an intention', () => {
    expect(validateMoveOut({ ...base, plannedExitDate: '2026-08-25' }).ok).toBe(false);
  });

  // This asks the owner; it does not announce a departure. Someone whose plans
  // changed this morning should still be able to raise it.
  it('allows today, and short notice generally', () => {
    expect(validateMoveOut({ ...base, plannedExitDate: '2026-08-26' }).ok).toBe(true);
    expect(validateMoveOut({ ...base, plannedExitDate: '2026-08-27' }).ok).toBe(true);
  });

  it('caps the note at what the server accepts', () => {
    expect(validateMoveOut({ ...base, reasonText: 'x'.repeat(1001) }).ok).toBe(false);
  });
});

describe('the reasons offered', () => {
  it('are all values the server accepts', () => {
    // Mirrors the MoveOutReason enum; a drifted value is a 400 at submit time.
    const enumValues = [
      'COURSE_COMPLETED', 'JOB_RELOCATION', 'TOO_EXPENSIVE', 'POOR_MAINTENANCE',
      'FOOD_QUALITY', 'ROOMMATE_ISSUES', 'BETTER_HOSTEL', 'PERSONAL_REASONS',
      'SAFETY_CONCERNS', 'RULES_TOO_STRICT', 'MOVING_CLOSER', 'OTHER',
    ];
    for (const reason of MOVE_OUT_REASONS) expect(enumValues).toContain(reason.value);
    expect(MOVE_OUT_REASONS).toHaveLength(enumValues.length);
  });
});

describe('what the tenant is told before tapping', () => {
  it('names the settlement, the notification and the bed', () => {
    const said = moveOutConsequences().join(' ').toLowerCase();
    expect(said).toContain('notified');
    expect(said).toContain('deposit');
    expect(said).toContain('available');
  });
});
