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

describe('processor disclosures match what each service actually does', () => {
  const text = () => JSON.stringify(privacyDocument.content);

  it('does not say receipts are emailed — they are sent over WhatsApp', () => {
    // EmailService.sendReceipt has no callers; receipts go as WhatsApp documents.
    expect(text()).not.toMatch(/Email delivery:[^"]*receipts/);
    expect(text()).toMatch(/Messaging:[^"]*receipts/);
  });

  it('discloses the font-delivery service that receives visitors’ IP addresses', () => {
    expect(text()).toMatch(/Web fonts:[^"]*IP address/);
  });
});

describe('owner onboarding with the payment partner is disclosed', () => {
  it('says owner KYC is shared for merchant onboarding and verification', () => {
    const text = JSON.stringify(privacyDocument.content);
    expect(text).toMatch(/Merchant onboarding and verification:[^"]*PAN/);
  });
});

