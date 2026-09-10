import { describe, expect, it } from 'vitest';
import { EDGE, GAP, needsScroll, placeCaption } from './spotlightPlacement';

const PHONE = { width: 390, height: 844 };
const CAPTION = { width: 340, height: 180 };

describe('placeCaption', () => {
  it('sits below the highlight when there is room', () => {
    const p = placeCaption({
      highlight: { top: 100, left: 20, width: 350, height: 120 },
      caption: CAPTION,
      viewport: PHONE,
    });
    expect(p.side).toBe('below');
    expect(p.top).toBe(100 + 120 + GAP);
  });

  it('flips above when the caption would run off the bottom', () => {
    const p = placeCaption({
      highlight: { top: 620, left: 20, width: 350, height: 140 },
      caption: CAPTION,
      viewport: PHONE,
    });
    expect(p.side).toBe('above');
    expect(p.top).toBe(620 - GAP - CAPTION.height);
  });

  it('centres the caption on the highlight', () => {
    const p = placeCaption({
      highlight: { top: 100, left: 120, width: 100, height: 60 },
      caption: { width: 200, height: 120 },
      viewport: PHONE,
    });
    // highlight centre 170 - half caption 100 = 70
    expect(p.left).toBe(70);
    expect(p.arrowLeft).toBe(100);
  });

  it('clamps to the viewport edge but keeps the arrow on the highlight', () => {
    // A highlight hard against the left edge (e.g. the first bottom-nav tab).
    const p = placeCaption({
      highlight: { top: 700, left: 0, width: 60, height: 56 },
      caption: CAPTION,
      viewport: PHONE,
    });
    expect(p.left).toBe(EDGE);
    // The tab's centre (30) is only 18px from the clamped caption edge, which
    // is inside the rounded corner — the arrow stops at the 22px inset rather
    // than poking out of it.
    expect(p.arrowLeft).toBe(22);
  });

  it('never lets the arrow leave the caption', () => {
    const p = placeCaption({
      highlight: { top: 300, left: 380, width: 10, height: 10 },
      caption: CAPTION,
      viewport: PHONE,
    });
    expect(p.arrowLeft).toBeLessThanOrEqual(CAPTION.width - 22);
    expect(p.arrowLeft).toBeGreaterThanOrEqual(22);
  });

  it('picks the roomier side when the highlight is taller than the screen', () => {
    const p = placeCaption({
      highlight: { top: -40, left: 0, width: 390, height: 900 },
      caption: CAPTION,
      viewport: PHONE,
    });
    // Nothing fits; below has more room than the 0px above.
    expect(p.side).toBe('below');
    // Clamped so the caption is still fully on screen.
    expect(p.top).toBeLessThanOrEqual(PHONE.height - CAPTION.height - EDGE);
    expect(p.top).toBeGreaterThanOrEqual(EDGE);
  });

  it('keeps the caption on screen when it is wider than the viewport', () => {
    const p = placeCaption({
      highlight: { top: 100, left: 10, width: 100, height: 40 },
      caption: { width: 500, height: 120 },
      viewport: { width: 320, height: 700 },
    });
    expect(p.left).toBe(EDGE);
  });
});

describe('needsScroll', () => {
  it('is false for an element comfortably in view', () => {
    expect(needsScroll({ element: { top: 200, left: 0, width: 300, height: 100 }, viewport: PHONE })).toBe(false);
  });

  it('is true for an element above the fold', () => {
    expect(needsScroll({ element: { top: -30, left: 0, width: 300, height: 100 }, viewport: PHONE })).toBe(true);
  });

  it('is true for an element running past the bottom', () => {
    expect(needsScroll({ element: { top: 800, left: 0, width: 300, height: 100 }, viewport: PHONE })).toBe(true);
  });
});
