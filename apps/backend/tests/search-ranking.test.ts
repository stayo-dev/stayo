import { describe, expect, it } from 'vitest';
import {
  SCORE,
  scoreField,
  bestScore,
  sortByScore,
  normalizePhone,
} from '@/lib/services/search/ranking';

/** Pure — no database. Runs under `npm run test:pure`. */

describe('normalizePhone', () => {
  it('strips formatting so the same number always compares equal', () => {
    expect(normalizePhone('+91 98765 43210')).toBe('919876543210');
    expect(normalizePhone('98765-43210')).toBe('9876543210');
    expect(normalizePhone(null)).toBe('');
  });
});

describe('scoreField — priority order', () => {
  it('ranks exact name above exact phone above exact room above exact hostel', () => {
    expect(scoreField('rahul', 'Rahul', 'name')).toBe(SCORE.EXACT_NAME);
    expect(scoreField('9876543210', '9876543210', 'phone')).toBe(SCORE.EXACT_PHONE);
    expect(scoreField('203', '203', 'room')).toBe(SCORE.EXACT_ROOM);
    expect(scoreField('mg road', 'MG Road', 'hostel')).toBe(SCORE.EXACT_HOSTEL);

    expect(SCORE.EXACT_NAME).toBeGreaterThan(SCORE.EXACT_PHONE);
    expect(SCORE.EXACT_PHONE).toBeGreaterThan(SCORE.EXACT_ROOM);
    expect(SCORE.EXACT_ROOM).toBeGreaterThan(SCORE.EXACT_HOSTEL);
  });

  it('ranks any exact match above any prefix match above any contains match', () => {
    expect(SCORE.EXACT_HOSTEL).toBeGreaterThan(SCORE.PREFIX_NAME);
    expect(SCORE.PREFIX_HOSTEL).toBeGreaterThan(SCORE.CONTAINS_NAME);
    expect(SCORE.CONTAINS_HOSTEL).toBeGreaterThan(SCORE.FUZZY);
  });

  it('is case and whitespace insensitive', () => {
    expect(scoreField('  RaHuL  ', 'rahul', 'name')).toBe(SCORE.EXACT_NAME);
  });
});

describe('scoreField — names', () => {
  it('treats a match on any word start as a prefix hit, not a weak substring', () => {
    // Searching a surname should rank strongly.
    expect(scoreField('sharma', 'Rahul Sharma', 'name')).toBe(SCORE.PREFIX_NAME);
  });

  it('still scores a mid-word match as contains', () => {
    expect(scoreField('harm', 'Rahul Sharma', 'name')).toBe(SCORE.CONTAINS_NAME);
  });

  it('returns no match when absent', () => {
    expect(scoreField('vikram', 'Rahul Sharma', 'name')).toBe(SCORE.NO_MATCH);
  });
});

describe('scoreField — phones', () => {
  it('matches regardless of formatting or country code on either side', () => {
    // Owners store the same number three different ways and search whichever
    // they remember — all must be an exact hit on the same person.
    expect(scoreField('9876543210', '+91 98765 43210', 'phone')).toBe(SCORE.EXACT_PHONE);
    expect(scoreField('+91 98765 43210', '919876543210', 'phone')).toBe(SCORE.EXACT_PHONE);
    expect(scoreField('919876543210', '9876543210', 'phone')).toBe(SCORE.EXACT_PHONE);
  });

  it('prefix-matches against the national number even when stored with +91', () => {
    expect(scoreField('98765', '+919876543210', 'phone')).toBe(SCORE.PREFIX_PHONE);
  });

  it('scores a leading fragment as a prefix', () => {
    expect(scoreField('98765', '9876543210', 'phone')).toBe(SCORE.PREFIX_PHONE);
  });

  it('scores a trailing fragment as contains', () => {
    expect(scoreField('43210', '9876543210', 'phone')).toBe(SCORE.CONTAINS_PHONE);
  });

  it('never treats a non-numeric query as a phone match', () => {
    // Otherwise "rahul" would phone-match every tenant via empty-string logic.
    expect(scoreField('rahul', '9876543210', 'phone')).toBe(SCORE.NO_MATCH);
  });

  it('handles a missing phone safely', () => {
    expect(scoreField('98765', null, 'phone')).toBe(SCORE.NO_MATCH);
  });
});

describe('scoreField — rooms', () => {
  it('matches an exact room number', () => {
    expect(scoreField('203', '203', 'room')).toBe(SCORE.EXACT_ROOM);
  });

  it('does not let room 20 outrank room 203 on an exact query', () => {
    expect(scoreField('203', '203', 'room')).toBeGreaterThan(scoreField('203', '2030', 'room'));
  });
});

describe('bestScore', () => {
  it('takes the strongest field, never the sum', () => {
    const score = bestScore('rahul', [
      { value: 'Rahul Sharma', field: 'name' },
      { value: '203', field: 'room' },
      { value: 'MG Road', field: 'hostel' },
    ]);
    expect(score).toBe(SCORE.PREFIX_NAME);
  });

  it('an exact name beats several weak partials combined', () => {
    const exact = bestScore('rahul', [{ value: 'Rahul', field: 'name' }]);
    const manyWeak = bestScore('ra', [
      { value: 'Sitara', field: 'name' },
      { value: 'Bangalore Road', field: 'hostel' },
    ]);
    expect(exact).toBeGreaterThan(manyWeak);
  });

  it('returns NO_MATCH when nothing matches', () => {
    expect(bestScore('zzz', [{ value: 'Rahul', field: 'name' }])).toBe(SCORE.NO_MATCH);
  });

  it('handles an empty query', () => {
    expect(bestScore('', [{ value: 'Rahul', field: 'name' }])).toBe(SCORE.NO_MATCH);
  });
});

describe('sortByScore', () => {
  it('orders by score descending', () => {
    const sorted = sortByScore([
      { score: 10, title: 'low' },
      { score: 100, title: 'high' },
      { score: 50, title: 'mid' },
    ]);
    expect(sorted.map((r) => r.title)).toEqual(['high', 'mid', 'low']);
  });

  it('breaks ties by title so results do not reshuffle between keystrokes', () => {
    const sorted = sortByScore([
      { score: 50, title: 'Zoya' },
      { score: 50, title: 'Amit' },
      { score: 50, title: 'Meera' },
    ]);
    expect(sorted.map((r) => r.title)).toEqual(['Amit', 'Meera', 'Zoya']);
  });

  it('does not mutate the input', () => {
    const input = [{ score: 1, title: 'a' }, { score: 2, title: 'b' }];
    sortByScore(input);
    expect(input.map((r) => r.title)).toEqual(['a', 'b']);
  });
});
