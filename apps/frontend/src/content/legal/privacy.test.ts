import { describe, expect, it } from 'vitest';
import { privacyDocument } from './privacy';

const text = () => JSON.stringify(privacyDocument.content);

describe('the Privacy Policy', () => {
  it('describes retention as anonymisation, not erasure — matching what closure actually does', () => {
    expect(text()).toMatch(/anonymis/i);
  });

  it('does not promise to delete financial records, which survive by design', () => {
    expect(text()).not.toMatch(/delete .{0,40}billing records/i);
  });

  it('describes the identity-document vault and that sharing is revocable', () => {
    expect(text()).toMatch(/revok/i);
  });

  it('does not claim to track behaviour or preferences (DPDP s.9)', () => {
    expect(text()).not.toMatch(/track your behaviour|track your preferences/i);
  });

  it('lists the Data Principal rights DPDP requires', () => {
    for (const right of ['access', 'correction', 'erasure', 'grievance', 'nomination']) {
      expect(text().toLowerCase()).toContain(right);
    }
  });

  it('states that payment credentials never reach Stayo', () => {
    expect(text()).toMatch(/never reach|do not store/i);
    expect(text()).toMatch(/CVV|card number/i);
  });

  it('names a Grievance Officer contact', () => {
    expect(text()).toContain('grievance@yourstayo.com');
  });
});
