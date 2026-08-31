import { describe, expect, it } from 'vitest';
import {
  CATEGORY_LABEL,
  HELP_GUIDES,
  TICKET_CATEGORIES,
  canSubmitReport,
  classifyProblem,
  guidesFor,
  hostelChannel,
  searchGuides,
  suggestCategory,
} from './helpCenter';

/**
 * Every route a guide is allowed to point at, transcribed from the live route
 * tables (`OwnerRoutes.tsx`, the tenant router, `ProfileRoutes.tsx`).
 *
 * A guidance card that opens a 404 is worse than no card at all: it costs the
 * reader their remaining trust at the exact moment they were already stuck. So
 * the links are pinned here, and renaming a route breaks this test rather than
 * quietly breaking the Help Centre.
 */
const REAL_ROUTES = new Set([
  '/owner/money',
  '/owner/money/collect',
  '/owner/money/payouts',
  '/owner/more/hostel',
  '/owner/more/service-requests',
  '/owner/home',
  '/owner/rooms/vacant',
  '/owner/tenants',
  '/owner/tenants/activations',
  '/tenant/room',
  '/tenant/money',
  '/tenant/complaints',
  '/tenant/move-out',
  '/profile/details',
  '/profile/documents',
]);

describe('the guidance catalogue', () => {
  it('only links to routes that exist', () => {
    for (const guide of HELP_GUIDES) {
      if (!guide.action) continue;
      expect(REAL_ROUTES.has(guide.action.to), `${guide.id} → ${guide.action.to}`).toBe(true);
    }
  });

  it('gives every guide an audience', () => {
    for (const guide of HELP_GUIDES) {
      expect(guide.audience.length).toBeGreaterThan(0);
    }
  });

  it('has no duplicate ids', () => {
    const ids = HELP_GUIDES.map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('shows an owner only owner-relevant guidance', () => {
    const ids = guidesFor('owner').map((g) => g.id);
    expect(ids).toContain('owner-payout');
    expect(ids).not.toContain('tenant-move-out');
  });

  it('shows shared guidance to both sides', () => {
    expect(guidesFor('owner').map((g) => g.id)).toContain('both-otp');
    expect(guidesFor('tenant').map((g) => g.id)).toContain('both-otp');
  });
});

describe('searching for an answer', () => {
  it('returns everything when nothing has been typed yet', () => {
    // A blank box must not mean a blank screen — browsing is how someone who
    // cannot name their problem finds it.
    expect(searchGuides('', 'tenant')).toEqual(guidesFor('tenant'));
    expect(searchGuides('   ', 'tenant')).toEqual(guidesFor('tenant'));
  });

  it('finds a guide by a word only its keywords carry', () => {
    // "geyser" appears nowhere in that guide's question.
    const top = searchGuides('geyser', 'tenant')[0];
    expect(top.id).toBe('tenant-room-broken');
  });

  it('ranks a keyword hit above an incidental word match', () => {
    const results = searchGuides('payout', 'owner');
    expect(results[0].id).toBe('owner-payout');
  });

  it('finds the listing-review answer however it is phrased', () => {
    for (const phrasing of ['amenities not showing', 'why is my listing pending', 'photos discover']) {
      const ids = searchGuides(phrasing, 'owner').map((g) => g.id);
      expect(ids.some((id) => id.startsWith('owner-listing') || id.startsWith('owner-cannot-edit')), phrasing).toBe(true);
    }
  });

  it('returns nothing rather than noise for an unrelated query', () => {
    expect(searchGuides('xylophone', 'tenant')).toEqual([]);
  });

  it('never offers an owner a tenant guide, whatever is typed', () => {
    const ids = searchGuides('move out', 'owner').map((g) => g.id);
    expect(ids).not.toContain('tenant-move-out');
  });
});

describe('whose problem is it', () => {
  it('sends physical hostel problems to the hostel', () => {
    for (const text of [
      'the geyser is not giving hot water',
      'my roommate plays music all night',
      'the food has been bad all week',
      'nobody has cleaned the bathroom',
    ]) {
      expect(classifyProblem(text), text).toBe('HOSTEL');
    }
  });

  it('keeps platform problems with Stayo', () => {
    for (const text of [
      'I cannot log in to the app',
      'the page is blank when I open payments',
      'money was deducted but the payment failed',
      'it keeps signing me out',
    ]) {
      expect(classifyProblem(text), text).toBe('STAYO');
    }
  });

  it('treats a tool failure as ours even when the subject is the hostel', () => {
    // "the app won't let me report my geyser" is a bug in our software, not a
    // plumbing job — the geyser is incidental to what has actually failed.
    expect(classifyProblem("the app won't let me report my geyser")).toBe('STAYO');
  });

  it('says it is unsure rather than guessing', () => {
    expect(classifyProblem('I need some help please')).toBe('UNSURE');
    expect(classifyProblem('')).toBe('UNSURE');
  });

  it('points each audience at its own hostel channel', () => {
    // The owner is not redirected to someone else — the owner *is* the hostel.
    expect(hostelChannel('tenant').to).toBe('/tenant/complaints');
    expect(hostelChannel('owner').to).toBe('/owner/more/service-requests');
    expect(REAL_ROUTES.has(hostelChannel('tenant').to)).toBe(true);
    expect(REAL_ROUTES.has(hostelChannel('owner').to)).toBe(true);
  });
});

describe('suggesting a category', () => {
  it('reads money problems as payment issues', () => {
    expect(suggestCategory('my refund has not come back')).toBe('PAYMENT_ISSUE');
    expect(suggestCategory('razorpay took the money twice')).toBe('PAYMENT_ISSUE');
  });

  it('reads sign-in problems as account issues', () => {
    expect(suggestCategory('I forgot my password')).toBe('ACCOUNT_ISSUE');
    expect(suggestCategory('the otp never arrives')).toBe('ACCOUNT_ISSUE');
  });

  it('reads broken screens as app bugs', () => {
    expect(suggestCategory('the rooms page is stuck loading')).toBe('APP_BUG');
  });

  it('falls back to something else rather than mislabelling', () => {
    expect(suggestCategory('I have a suggestion for you')).toBe('OTHER');
  });

  it('only ever suggests a category the backend accepts', () => {
    // The backend rejects anything outside its own TICKET_CATEGORIES list.
    for (const text of ['refund', 'password', 'crash', 'hello there', '']) {
      expect(TICKET_CATEGORIES).toContain(suggestCategory(text));
    }
  });

  it('labels every category it can suggest', () => {
    for (const category of TICKET_CATEGORIES) {
      expect(CATEGORY_LABEL[category]).toBeTruthy();
    }
  });
});

describe('accepting a report', () => {
  it('needs a subject and a description with something in it', () => {
    expect(canSubmitReport('', 'the payments page will not load at all')).toBe(false);
    expect(canSubmitReport('Cannot pay', '')).toBe(false);
    expect(canSubmitReport('Cannot pay', 'broken')).toBe(false);
    expect(canSubmitReport('Cannot pay', 'the payments page will not load at all')).toBe(true);
  });

  it('does not count whitespace as an answer', () => {
    expect(canSubmitReport('   ', '                     ')).toBe(false);
  });
});
