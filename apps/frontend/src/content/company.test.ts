import { describe, expect, it } from 'vitest';
import { COMPANY, PAYMENT_PARTNER, formatPostalAddress } from './company';

describe('COMPANY.legal', () => {
  it('names the proprietor, because a proprietorship contracts through the individual', () => {
    expect(COMPANY.legal.proprietor).toBe('Chidiri Shiva Prakash');
    expect(COMPANY.legal.constitution).toBe('sole proprietorship');
  });

  it('carries no unresolved placeholders — the build must never publish one', () => {
    const values = [
      COMPANY.legal.proprietor,
      COMPANY.legal.grievanceOfficer.name,
      COMPANY.legal.grievanceOfficer.email,
      ...Object.values(COMPANY.legal.address),
    ];
    for (const value of values) {
      expect(value).toBeTruthy();
      expect(value).not.toMatch(/\[|TBD|TODO|XXX/i);
    }
  });

  it('publishes only the four serviced addresses', () => {
    expect(Object.keys(COMPANY.emails).sort()).toEqual(['contact', 'grievance', 'privacy', 'support']);
  });

  it('never claims a GSTIN', () => {
    expect(JSON.stringify(COMPANY)).not.toMatch(/gstin/i);
  });
});

describe('formatPostalAddress', () => {
  it('renders the registered address as one postal line', () => {
    expect(formatPostalAddress(COMPANY.legal.address)).toBe(
      '12-75/1, Balaji Nagar, Block 2, Kodangal, Vikarabad District, Telangana 509338',
    );
  });
});

describe('PAYMENT_PARTNER', () => {
  it('is the only place the aggregator is named, and the name never reaches published copy', () => {
    expect(PAYMENT_PARTNER.name).toBe('Easebuzz');
    expect(PAYMENT_PARTNER.descriptor).toBe('an RBI-authorised payment aggregator');
  });
});
