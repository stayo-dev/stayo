import { describe, expect, it } from 'vitest';
import { hasChanges } from './dirtyState';

describe('hasChanges', () => {
  it('is clean when nothing has been touched', () => {
    const loaded = { depositMonths: 2, allowPartial: false };

    expect(hasChanges(loaded, { ...loaded })).toBe(false);
  });

  it('is dirty once a value differs', () => {
    expect(hasChanges({ depositMonths: 2 }, { depositMonths: 3 })).toBe(true);
  });

  it('stays clean when a value is retyped to the same thing', () => {
    // A "touched" flag would report dirty here, and offer to save nothing.
    expect(hasChanges({ dueDay: 5 }, { dueDay: 5 })).toBe(false);
  });

  it('stays clean when a toggle is flipped off and back on', () => {
    const loaded = { lateFeeEnabled: true };
    const afterTwoTaps = { lateFeeEnabled: true };

    expect(hasChanges(loaded, afterTwoTaps)).toBe(false);
  });

  it('is clean before the policy has loaded, rather than treating null as a change', () => {
    // Otherwise Save would flash on every screen during the first render.
    expect(hasChanges(null, { depositMonths: 2 })).toBe(false);
    expect(hasChanges(undefined, { depositMonths: 2 })).toBe(false);
  });

  it('ignores key order', () => {
    expect(hasChanges({ a: 1, b: 2 }, { b: 2, a: 1 } as any)).toBe(false);
  });

  it('compares nested objects by value', () => {
    expect(hasChanges({ fee: { type: 'FLAT', amount: 50 } }, { fee: { type: 'FLAT', amount: 50 } })).toBe(false);
    expect(hasChanges({ fee: { type: 'FLAT', amount: 50 } }, { fee: { type: 'FLAT', amount: 60 } })).toBe(true);
  });

  it('compares arrays by contents and order', () => {
    expect(hasChanges({ fields: ['phone', 'email'] }, { fields: ['phone', 'email'] })).toBe(false);
    expect(hasChanges({ fields: ['phone', 'email'] }, { fields: ['email', 'phone'] })).toBe(true);
    expect(hasChanges({ fields: ['phone'] }, { fields: ['phone', 'email'] })).toBe(true);
  });

  it('distinguishes a missing key from an explicitly undefined one only by value', () => {
    expect(hasChanges({ a: 1 } as Record<string, unknown>, { a: 1, b: undefined })).toBe(true);
  });

  it('does not treat two blank numeric fields as an edit', () => {
    // Empty numeric inputs parse to NaN; both blank means unchanged.
    expect(hasChanges({ amount: Number.NaN }, { amount: Number.NaN })).toBe(false);
  });

  it('distinguishes types that coerce to the same string', () => {
    expect(hasChanges({ months: 2 } as Record<string, unknown>, { months: '2' })).toBe(true);
  });
});
