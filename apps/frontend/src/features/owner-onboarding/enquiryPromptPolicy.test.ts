import { describe, it, expect } from 'vitest';
import {
  shouldShowEnquiryPrompt,
  computeScrollFraction,
  ENQUIRY_PROMPT_COOLDOWN_MS,
  ENQUIRY_PROMPT_SCROLL_THRESHOLD,
} from './enquiryPromptPolicy';

// Regression: the prompt never appeared on the real landing page. Measured in
// a headless browser against the live page, `document.documentElement` is NOT
// the scroller — theme.css sets `overflow-x: hidden` on both html and body,
// which per CSS spec forces `overflow-y: auto`, making <body> the scroll
// container. documentElement.scrollHeight was 437 (== viewport) while
// body.scrollHeight was 5101, so the old `documentElement.scrollHeight -
// innerHeight` was 0 and the fraction was pinned at 0 forever.
describe('computeScrollFraction', () => {
  it('computes the fraction from the real scroller, not the viewport-sized one', () => {
    // The exact numbers measured on the live landing page.
    expect(computeScrollFraction({ scrollTop: 2332, contentHeight: 5101, viewportHeight: 437 })).toBeCloseTo(0.5, 2);
  });

  it('returns 0 when the content cannot scroll', () => {
    expect(computeScrollFraction({ scrollTop: 0, contentHeight: 437, viewportHeight: 437 })).toBe(0);
  });

  it('returns 0 rather than a negative or Infinity when content is shorter than the viewport', () => {
    expect(computeScrollFraction({ scrollTop: 0, contentHeight: 200, viewportHeight: 900 })).toBe(0);
  });

  it('clamps to the 0..1 range so overscroll cannot produce a fraction above 1', () => {
    expect(computeScrollFraction({ scrollTop: 99999, contentHeight: 5101, viewportHeight: 437 })).toBe(1);
    expect(computeScrollFraction({ scrollTop: -50, contentHeight: 5101, viewportHeight: 437 })).toBe(0);
  });

  it('degrades to 0 on non-finite input rather than propagating NaN into the threshold check', () => {
    expect(computeScrollFraction({ scrollTop: Number.NaN, contentHeight: 5101, viewportHeight: 437 })).toBe(0);
    expect(computeScrollFraction({ scrollTop: 100, contentHeight: Number.NaN, viewportHeight: 437 })).toBe(0);
  });

  it('crosses the show-threshold at the point the policy expects', () => {
    const below = computeScrollFraction({ scrollTop: 1000, contentHeight: 5101, viewportHeight: 437 });
    const above = computeScrollFraction({ scrollTop: 2400, contentHeight: 5101, viewportHeight: 437 });
    expect(below).toBeLessThan(ENQUIRY_PROMPT_SCROLL_THRESHOLD);
    expect(above).toBeGreaterThanOrEqual(ENQUIRY_PROMPT_SCROLL_THRESHOLD);
  });
});

const NOW = new Date('2026-08-06T12:00:00Z').getTime();

const base = {
  scrollFraction: 0.5,
  dismissedAt: null as number | null,
  isOwnerWithHostel: false,
  alreadyShownThisSession: false,
  now: NOW,
};

describe('shouldShowEnquiryPrompt', () => {
  it('shows once the visitor has scrolled past the threshold', () => {
    expect(shouldShowEnquiryPrompt(base)).toBe(true);
  });

  it('stays hidden above the fold', () => {
    expect(shouldShowEnquiryPrompt({ ...base, scrollFraction: ENQUIRY_PROMPT_SCROLL_THRESHOLD - 0.01 })).toBe(false);
  });

  // An owner who already has a hostel is not a lead. The landing CTA already
  // sends them to the dashboard; the prompt must not contradict it.
  it('never interrupts an owner who already has a hostel', () => {
    expect(shouldShowEnquiryPrompt({ ...base, isOwnerWithHostel: true })).toBe(false);
  });

  it('respects a recent dismissal', () => {
    expect(shouldShowEnquiryPrompt({ ...base, dismissedAt: NOW - 1000 })).toBe(false);
  });

  it('shows again once the cooldown has elapsed', () => {
    expect(shouldShowEnquiryPrompt({ ...base, dismissedAt: NOW - ENQUIRY_PROMPT_COOLDOWN_MS - 1 })).toBe(true);
  });

  it('does not reappear after being shown once in the same session', () => {
    expect(shouldShowEnquiryPrompt({ ...base, alreadyShownThisSession: true })).toBe(false);
  });

  // A corrupt localStorage value must not wedge the prompt permanently off.
  it('ignores an unparseable dismissal timestamp', () => {
    expect(shouldShowEnquiryPrompt({ ...base, dismissedAt: Number.NaN })).toBe(true);
  });

  it('ignores a dismissal timestamp from the future', () => {
    expect(shouldShowEnquiryPrompt({ ...base, dismissedAt: NOW + 60_000 })).toBe(true);
  });
});
