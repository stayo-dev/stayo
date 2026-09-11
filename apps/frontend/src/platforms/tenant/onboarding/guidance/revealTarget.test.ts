import { describe, expect, it } from 'vitest';
import { isComfortablyVisible, revealScrollTop, type RevealInput } from './revealTarget';

/** A phone mid-form: the action bar covers the bottom 108px, nothing at the top. */
const base: RevealInput = {
  fieldTop: 1200,
  fieldHeight: 80,
  viewportHeight: 800,
  scrollY: 0,
  topInset: 0,
  bottomInset: 108,
  maxScroll: 2400,
};

describe('revealScrollTop', () => {
  it('rests the field about a third down the free space, not at the very top', () => {
    // free = 800 - 108 = 692; offset = (692 - 80) / 3 = 204
    expect(revealScrollTop(base)).toBe(1200 - 204);
  });

  it('keeps the field clear of a sticky summary at the top', () => {
    const withSummary = revealScrollTop({ ...base, topInset: 96 });
    expect(withSummary).toBeLessThan(revealScrollTop(base));
    // The field's top lands below the summary, never under it.
    expect(base.fieldTop - withSummary).toBeGreaterThanOrEqual(96);
  });

  it('never scrolls past the end of the page', () => {
    expect(revealScrollTop({ ...base, fieldTop: 2900, maxScroll: 2400 })).toBe(2400);
  });

  it('never scrolls above the top of the page', () => {
    expect(revealScrollTop({ ...base, fieldTop: 40 })).toBe(0);
  });

  it('pins a field taller than the screen just below the top inset', () => {
    const tall = { ...base, fieldTop: 1200, fieldHeight: 900, topInset: 96 };
    expect(revealScrollTop(tall)).toBe(1200 - 96);
  });
});

describe('isComfortablyVisible', () => {
  it('is true for a field sitting in the open middle of the screen', () => {
    expect(isComfortablyVisible({ ...base, fieldTop: 1200, scrollY: 1000 })).toBe(true);
  });

  it('is false for a field hidden under the action bar', () => {
    // top 1200 - scroll 480 = 720; bottom 800 > 800 - 108
    expect(isComfortablyVisible({ ...base, scrollY: 480 })).toBe(false);
  });

  it('is false for a field scrolled off the top', () => {
    expect(isComfortablyVisible({ ...base, scrollY: 1300 })).toBe(false);
  });

  it('is false for a field behind the sticky summary', () => {
    expect(isComfortablyVisible({ ...base, scrollY: 1150, topInset: 96 })).toBe(false);
  });
});
