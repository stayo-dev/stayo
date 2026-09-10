import { describe, expect, it } from 'vitest';
import { HOSTEL_TYPE_OPTIONS, impliedGender, needsGenderAtOnboarding, hostelTypeLabel } from './hostelType';

describe('HOSTEL_TYPE_OPTIONS', () => {
  it('offers the four types the column is written with', () => {
    expect(HOSTEL_TYPE_OPTIONS.map((o) => o.code)).toEqual(['BOYS', 'GIRLS', 'CO_LIVING', 'WORKING_PROS']);
  });

  it('labels them in the owner\'s words, not the database\'s', () => {
    expect(hostelTypeLabel('CO_LIVING')).toBe('Co-ed');
    expect(hostelTypeLabel('WORKING_PROS')).toBe('Working professionals');
    expect(hostelTypeLabel('BOYS')).toBe('Boys');
  });

  it('has nothing to say about a type it does not know', () => {
    expect(hostelTypeLabel(null)).toBe('');
    expect(hostelTypeLabel('SOMETHING_ELSE')).toBe('');
  });
});

describe('impliedGender', () => {
  it('derives a gender only where the hostel type states one outright', () => {
    expect(impliedGender('BOYS')).toBe('Male');
    expect(impliedGender('GIRLS')).toBe('Female');
  });

  it('derives nothing from a type that admits anyone', () => {
    // Co-living and working-professionals take any gender; guessing would
    // write an answer nobody gave into a permanent tenant record.
    expect(impliedGender('CO_LIVING')).toBeNull();
    expect(impliedGender('WORKING_PROS')).toBeNull();
  });

  it('derives nothing from an unset type', () => {
    // The common case today: the column is nullable and was never written,
    // because nothing ever asked the owner.
    expect(impliedGender(null)).toBeNull();
    expect(impliedGender('')).toBeNull();
    expect(impliedGender(undefined)).toBeNull();
  });

  it('reads a stored value whatever its casing', () => {
    expect(impliedGender('boys')).toBe('Male');
    expect(impliedGender('  Girls  ')).toBe('Female');
  });
});

describe('needsGenderAtOnboarding', () => {
  it('skips the question when the hostel has already answered it', () => {
    expect(needsGenderAtOnboarding('BOYS')).toBe(false);
    expect(needsGenderAtOnboarding('GIRLS')).toBe(false);
  });

  it('asks in the identity step for a hostel that takes anyone', () => {
    expect(needsGenderAtOnboarding('CO_LIVING')).toBe(true);
    expect(needsGenderAtOnboarding('WORKING_PROS')).toBe(true);
  });

  it('asks when the type is unknown — the safe default', () => {
    expect(needsGenderAtOnboarding(null)).toBe(true);
  });

  it('mirrors impliedGender exactly, so the two can never disagree', () => {
    // One rule, read two ways. If these drift, a tenant is either asked a
    // question already answered or not asked one that was never answered.
    for (const code of ['BOYS', 'GIRLS', 'CO_LIVING', 'WORKING_PROS', null, 'JUNK']) {
      expect(needsGenderAtOnboarding(code)).toBe(impliedGender(code) === null);
    }
  });
});
