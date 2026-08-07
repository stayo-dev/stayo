import { describe, it, expect } from 'vitest';
import {
  shouldShowEnquiryPrompt,
  explainEnquiryPromptSuppression,
  computeScrollFraction,
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

const base = {
  scrollFraction: 0.5,
  isOwnerWithHostel: false,
  alreadyShownThisSession: false,
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

  it('does not reappear after being shown once in the same page view', () => {
    expect(shouldShowEnquiryPrompt({ ...base, alreadyShownThisSession: true })).toBe(false);
  });

  // The persistent 7-day cooldown was deliberately removed: on a pre-launch
  // marketing page, re-asking costs less than silently never asking again, and
  // an invisible stored timestamp made the feature look broken. A reload must
  // always be able to bring the prompt back.
  it('shows again on a fresh page view, with no persistent suppression', () => {
    expect(shouldShowEnquiryPrompt({ ...base, alreadyShownThisSession: false })).toBe(true);
  });
});

describe('explainEnquiryPromptSuppression', () => {
  it('returns null when the prompt should show', () => {
    expect(explainEnquiryPromptSuppression(base)).toBeNull();
  });

  it('names the signed-in-owner case, which is otherwise indistinguishable from a bug', () => {
    expect(explainEnquiryPromptSuppression({ ...base, isOwnerWithHostel: true })).toMatch(/owner/i);
  });

  it('reports how far the visitor still has to scroll', () => {
    expect(explainEnquiryPromptSuppression({ ...base, scrollFraction: 0.1 })).toMatch(/40%/);
  });

  it('explains the once-per-page-view rule', () => {
    expect(explainEnquiryPromptSuppression({ ...base, alreadyShownThisSession: true })).toMatch(/reload/i);
  });
});
