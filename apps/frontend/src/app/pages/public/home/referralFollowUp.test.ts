import { describe, expect, it } from 'vitest';
import { validateFollowUp } from './referralFollowUp';

describe('validateFollowUp', () => {
  it('accepts an owner number and sends it as owner_contact', () => {
    const result = validateFollowUp({ mode: 'number', value: ' +91 98765 43210 ' });
    expect(result.valid).toBe(true);
    expect(result.payload).toEqual({ owner_contact: '+91 98765 43210' });
  });

  it('rejects an email in the number field — we are asking for a phone call', () => {
    expect(validateFollowUp({ mode: 'number', value: 'owner@example.com' }).valid).toBe(false);
  });

  it('rejects a number that is not an Indian mobile', () => {
    expect(validateFollowUp({ mode: 'number', value: '12345' }).valid).toBe(false);
  });

  it('points an empty number field at the way out rather than scolding', () => {
    const result = validateFollowUp({ mode: 'number', value: '   ' });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('don’t know it');
  });

  it('accepts an area for the student who does not have the number', () => {
    const result = validateFollowUp({ mode: 'area', value: '  Ameerpet  ' });
    expect(result.valid).toBe(true);
    expect(result.payload).toEqual({ area_query: 'Ameerpet' });
  });

  it('rejects an area too short to find anyone by', () => {
    expect(validateFollowUp({ mode: 'area', value: 'a' }).valid).toBe(false);
  });

  it('never returns a payload when it is not valid', () => {
    for (const draft of [
      { mode: 'number' as const, value: '' },
      { mode: 'number' as const, value: 'nope' },
      { mode: 'area' as const, value: '' },
    ]) {
      expect(validateFollowUp(draft).payload).toBeNull();
    }
  });
});
