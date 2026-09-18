import { describe, expect, it } from 'vitest';
import { AREA_MAX, classifyContact, validateCoverage, validateHostelReferral } from './coverageRequest';

describe('classifyContact', () => {
  it('treats blank as empty, because contact is optional', () => {
    expect(classifyContact('')).toBe('empty');
    expect(classifyContact('   ')).toBe('empty');
  });

  it('recognises Indian mobile numbers with or without country code', () => {
    expect(classifyContact('9876543210')).toBe('phone');
    expect(classifyContact('+91 98765 43210')).toBe('phone');
  });

  it('rejects numbers that are not Indian mobiles', () => {
    expect(classifyContact('1234567890')).toBe('invalid');
    expect(classifyContact('98765')).toBe('invalid');
  });

  it('recognises an email and rejects a malformed one', () => {
    expect(classifyContact('a@b.co')).toBe('email');
    expect(classifyContact('a@b')).toBe('invalid');
  });
});

describe('validateCoverage', () => {
  it('accepts an area with no contact at all — the signal is the point', () => {
    const result = validateCoverage({ area: '  Osmania University  ', contact: '' });
    expect(result.valid).toBe(true);
    expect(result.payload).toEqual({ kind: 'AREA', area_query: 'Osmania University', source: 'HOME' });
  });

  it('includes a valid contact when one is given', () => {
    const result = validateCoverage({ area: 'BITS Pilani', contact: '+91 98765 43210' });
    expect(result.payload?.contact).toBe('+91 98765 43210');
  });

  it('rejects an area that is too short', () => {
    const result = validateCoverage({ area: 'a', contact: '' });
    expect(result.valid).toBe(false);
    expect(result.errors.area).toBeTruthy();
    expect(result.payload).toBeNull();
  });

  it('rejects an area past the maximum length', () => {
    expect(validateCoverage({ area: 'x'.repeat(AREA_MAX + 1), contact: '' }).valid).toBe(false);
  });

  it('rejects a malformed contact rather than silently dropping it', () => {
    const result = validateCoverage({ area: 'Osmania University', contact: 'nope' });
    expect(result.valid).toBe(false);
    expect(result.errors.contact).toBeTruthy();
  });

  it('passes the source through', () => {
    expect(validateCoverage({ area: 'Osmania University', contact: '' }, 'HOME_EMPTY').payload?.source).toBe('HOME_EMPTY');
  });
});

describe('validateHostelReferral', () => {
  it('accepts a hostel name on its own — the number is a bonus, not a gate', () => {
    const result = validateHostelReferral({ hostelName: '  Sri Sai Boys Hostel ', ownerContact: '' });
    expect(result.valid).toBe(true);
    expect(result.payload).toEqual({ kind: 'HOSTEL', hostel_name: 'Sri Sai Boys Hostel', source: 'HOME' });
  });

  it("includes the owner's number when one is given", () => {
    const result = validateHostelReferral({ hostelName: 'Sri Sai', ownerContact: '9876543210' });
    expect(result.payload?.owner_contact).toBe('9876543210');
  });

  it('rejects a name too short to identify a hostel', () => {
    const result = validateHostelReferral({ hostelName: 'ab', ownerContact: '' });
    expect(result.valid).toBe(false);
    expect(result.errors.hostelName).toBeTruthy();
    expect(result.payload).toBeNull();
  });

  it('rejects a malformed owner number rather than dropping it', () => {
    const result = validateHostelReferral({ hostelName: 'Sri Sai', ownerContact: '12345' });
    expect(result.valid).toBe(false);
    expect(result.errors.ownerContact).toBeTruthy();
  });
});
