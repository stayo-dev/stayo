import { describe, it, expect } from 'vitest';
import {
  shouldShowEnquiryPrompt,
  ENQUIRY_PROMPT_COOLDOWN_MS,
  ENQUIRY_PROMPT_SCROLL_THRESHOLD,
} from './enquiryPromptPolicy';

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
