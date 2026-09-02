import { describe, expect, it } from 'vitest';
import { audienceConfirmation } from './audienceConfirmation';

describe('audienceConfirmation', () => {
  it('states the restriction for a boys-only hostel', () => {
    const c = audienceConfirmation('BOYS');
    expect(c.required).toBe(true);
    expect(c.statement).toBe('This hostel takes boys only.');
  });

  it('states it for a girls-only hostel', () => {
    expect(audienceConfirmation('GIRLS').statement).toBe('This hostel takes girls only.');
  });

  it('says nothing where the hostel takes anyone', () => {
    // Nothing to disclose: these tenants pick their gender during onboarding,
    // as they always have.
    for (const code of ['CO_LIVING', 'WORKING_PROS']) {
      expect(audienceConfirmation(code).required).toBe(false);
      expect(audienceConfirmation(code).statement).toBeNull();
    }
  });

  it('says nothing when the type was never set', () => {
    // The common case today. Silence is right — claiming a restriction that
    // was never recorded would turn seekers away from a hostel that wants them.
    expect(audienceConfirmation(null).required).toBe(false);
    expect(audienceConfirmation(undefined).required).toBe(false);
    expect(audienceConfirmation('').required).toBe(false);
  });

  it('reads a stored value whatever its casing', () => {
    expect(audienceConfirmation('boys').required).toBe(true);
    expect(audienceConfirmation('  Girls ').statement).toBe('This hostel takes girls only.');
  });

  it('never asks for a gender — it only states one', () => {
    // The distinction that keeps one fact in one place: the hostel type
    // settles the gender, so this screen discloses rather than collects.
    const c = audienceConfirmation('BOYS');
    expect(c.acknowledgement).toBe('I understand, and this applies to me');
    expect(Object.keys(c).sort()).toEqual(['acknowledgement', 'required', 'statement']);
  });
});
