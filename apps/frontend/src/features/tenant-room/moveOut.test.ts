import { describe, expect, it } from 'vitest';
import {
  MOVE_OUT_REASONS,
  moveOutConsequences,
  todayISO,
  validateMoveOut,
  ADDRESSABLE_REASONS,
  isAddressable,
  retentionOffer,
  hasFeedback,
  feedbackDestinations,
  raiseTarget,
} from './moveOut';

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

describe('which reasons the hostel can still act on', () => {
  // Asking *why* before *when* is the whole point: it decides whether there is
  // anything worth offering at all.
  it('treats a broken thing, the food, the roommates and the price as fixable', () => {
    for (const reason of ['POOR_MAINTENANCE', 'FOOD_QUALITY', 'ROOMMATE_ISSUES', 'TOO_EXPENSIVE', 'SAFETY_CONCERNS', 'RULES_TOO_STRICT']) {
      expect(isAddressable(reason)).toBe(true);
      expect(retentionOffer(reason)).not.toBeNull();
    }
  });

  // Someone whose course ended is not a problem to solve. Putting an obstacle
  // in front of them would be insulting, not persuasive.
  it('offers nothing when leaving is simply the right thing', () => {
    for (const reason of ['COURSE_COMPLETED', 'JOB_RELOCATION', 'MOVING_CLOSER', 'PERSONAL_REASONS', 'BETTER_HOSTEL', 'OTHER']) {
      expect(isAddressable(reason)).toBe(false);
      expect(retentionOffer(reason)).toBeNull();
    }
  });

  it('offers something specific rather than "we would like to help"', () => {
    expect(retentionOffer('ROOMMATE_ISSUES')!.body).toMatch(/room/i);
    expect(retentionOffer('FOOD_QUALITY')!.action).toMatch(/food/i);
    // Nothing on offer may imply the move-out is blocked or delayed.
    for (const reason of ADDRESSABLE_REASONS) {
      const offer = retentionOffer(reason)!;
      expect(`${offer.headline} ${offer.body} ${offer.action}`).not.toMatch(/cannot|not allowed|must first|required/i);
    }
  });
});

describe('the parting feedback', () => {
  it('is optional in both halves', () => {
    expect(hasFeedback({ rating: 0, note: '   ' })).toBe(false);
    expect(hasFeedback({ rating: 4, note: '' })).toBe(true);
    expect(hasFeedback({ rating: 0, note: 'Hot water never worked' })).toBe(true);
  });

  // Two rating systems for one hostel disagree within a week, and the invisible
  // one is the one that gets ignored.
  it('sends a rating to the public review, and a note privately', () => {
    expect(feedbackDestinations({ rating: 4, note: '' })).toEqual({ review: true, privateNote: false });
    expect(feedbackDestinations({ rating: 0, note: 'Third-floor bathroom' })).toEqual({ review: false, privateNote: true });
    expect(feedbackDestinations({ rating: 5, note: 'Great' })).toEqual({ review: true, privateNote: true });
  });

  it('sends nothing when they skipped it', () => {
    expect(feedbackDestinations({ rating: 0, note: '' })).toEqual({ review: false, privateNote: false });
  });
});

describe('raising it instead of leaving', () => {
  it('gives every addressable reason somewhere to file and something to answer', () => {
    for (const reason of ADDRESSABLE_REASONS) {
      const target = raiseTarget(reason)!;
      expect(target).not.toBeNull();
      // A question, not a blank box — "describe your issue" is why nobody does.
      // Not necessarily the last character: the safety prompt asks first and
      // then tells you what to include.
      expect(target.prompt).toContain('?');
      expect(target.category.length).toBeGreaterThan(0);
    }
  });

  it('routes a roommate problem at the room, not at maintenance', () => {
    expect(raiseTarget('ROOMMATE_ISSUES')!.type).toBe('ROOM_CHANGE');
  });

  it('only files against types the enum actually has', () => {
    // ServiceRequestType is a Postgres enum; an invented value is a 500.
    const valid = ['MAINTENANCE', 'ROOM_CHANGE', 'CLEANING', 'LOST_KEY', 'VISITOR_PASS', 'EXTRA_MATTRESS'];
    for (const reason of ADDRESSABLE_REASONS) {
      expect(valid).toContain(raiseTarget(reason)!.type);
    }
  });

  it('carries the real subject in the category, since the type cannot express it', () => {
    // Food files as MAINTENANCE because that is the widest bucket available —
    // the category is what makes it legible to the owner.
    expect(raiseTarget('FOOD_QUALITY')!.category).toBe('Food quality');
    expect(raiseTarget('TOO_EXPENSIVE')!.category).toBe('Rent');
  });

  it('offers nothing to file for reasons nobody can fix', () => {
    expect(raiseTarget('COURSE_COMPLETED')).toBeNull();
  });
});
