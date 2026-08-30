import { describe, it, expect } from 'vitest';
import { activationDraftKey } from './activationTypes';

describe('activationDraftKey', () => {
  it('keys by the activation token whenever there is one', () => {
    expect(activationDraftKey('tok_abc', 't-1')).toBe('tok_abc');
  });

  it('falls back to the tenancy for a claimed tenant, who has no token', () => {
    expect(activationDraftKey('', 't-1')).toBe('tenant:t-1');
    expect(activationDraftKey(null, 't-1')).toBe('tenant:t-1');
  });

  it('never returns the same key for two different tenancies', () => {
    // The reason this is not a fixed "session" string: two roommates claiming
    // on one handset must not read each other's identity form.
    expect(activationDraftKey('', 't-1')).not.toBe(activationDraftKey('', 't-2'));
  });

  it('disables drafts rather than inventing a shared key when nothing is known', () => {
    expect(activationDraftKey('', '')).toBe('');
    expect(activationDraftKey(null, null)).toBe('');
    expect(activationDraftKey('  ', '  ')).toBe('');
  });
});
