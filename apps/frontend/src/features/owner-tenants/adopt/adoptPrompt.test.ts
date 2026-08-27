import { describe, expect, it } from 'vitest';
import { shouldOfferAdoption, adoptionPromptText } from './adoptPrompt';

describe('shouldOfferAdoption', () => {
  it('offers once an unopened invitation has gone quiet for a week', () => {
    expect(shouldOfferAdoption({ openedAt: null, sentDaysAgo: 12 })).toBe(true);
    expect(shouldOfferAdoption({ openedAt: null, sentDaysAgo: 7 })).toBe(true);
  });

  it('stays quiet while the invitation is still fresh', () => {
    expect(shouldOfferAdoption({ openedAt: null, sentDaysAgo: 2 })).toBe(false);
  });

  it('still offers when the tenant opened it but never finished — openedAt is deliberately not a gate', () => {
    expect(shouldOfferAdoption({ openedAt: '2026-08-01', sentDaysAgo: 20 })).toBe(true);
  });
});

describe('adoptionPromptText', () => {
  it('states the fact and the remedy, without blaming anyone or assuming gender', () => {
    expect(adoptionPromptText('Rakesh', 12))
      .toBe("Rakesh hasn't opened this invite in 12 days. You can keep their records yourself and invite them again anytime.");
  });

  it('reads naturally at exactly one day', () => {
    expect(adoptionPromptText('Rakesh', 1))
      .toBe("Rakesh hasn't opened this invite in 1 day. You can keep their records yourself and invite them again anytime.");
  });
});
