import { describe, expect, it } from 'vitest';
import { legalNameToStore } from './legalName';

describe('legalNameToStore', () => {
  it('stores nothing when the registered name matches the hostel name', () => {
    // The field exists for the case where they differ. Storing a duplicate
    // means the receipt's name silently stops following the hostel's when it
    // is renamed, and the owner cannot tell "set" from "defaulted".
    expect(legalNameToStore('Sri Adithya Boys Hostel', 'Sri Adithya Boys Hostel')).toBeNull();
  });

  it('ignores casing and stray spacing when comparing', () => {
    expect(legalNameToStore('  sri adithya boys hostel ', 'Sri Adithya Boys Hostel')).toBeNull();
  });

  it('stores a genuinely different registered name', () => {
    expect(legalNameToStore('Adithya Hospitality Pvt Ltd', 'Sri Adithya Boys Hostel')).toBe(
      'Adithya Hospitality Pvt Ltd',
    );
  });

  it('trims what it stores', () => {
    expect(legalNameToStore('  Adithya Hospitality  ', 'Sri Adithya')).toBe('Adithya Hospitality');
  });

  it('treats blank as nothing to store', () => {
    for (const value of ['', '   ', null, undefined]) {
      expect(legalNameToStore(value as any, 'Sri Adithya')).toBeNull();
    }
  });
});
