import { describe, expect, it } from 'vitest';
import { countMeta, gapHint, heroMode, missingIn, stayMeta, totalGaps } from './profileHub';

const GROUPS = ['personal_info', 'contact_info', 'emergency_info', 'academic_info'];

/** The live account from the screenshots: name, DOB, phone, email, guardian — no college. */
const speakcode = {
  profile: { name: 'speakcode', email: 'speakcode01@gmail.com', phone: '+917013216327' },
  tenant: { date_of_birth: '2006-05-21', guardian_name: 'Megha', guardian_phone: '+917032204420' },
  contacts: {},
};

describe('what is missing', () => {
  it('says nothing about a group that is complete', () => {
    // The whole point: a filled field earns silence.
    expect(gapHint('personal_info', speakcode)).toBeNull();
    expect(gapHint('contact_info', speakcode)).toBeNull();
    expect(gapHint('emergency_info', speakcode)).toBeNull();
  });

  it('names both gaps rather than counting them', () => {
    expect(gapHint('academic_info', speakcode)).toBe('Add college & course');
  });

  it('names a single gap', () => {
    const sources = { ...speakcode, tenant: { ...speakcode.tenant, college_name: 'BVRIT' } };
    expect(gapHint('academic_info', sources)).toBe('Add course');
  });

  it('never tells a working professional to add a college', () => {
    const pro = { tenant: { profile_type: 'WORKING_PROFESSIONAL', office_name: 'Acme' } };
    expect(missingIn('academic_info', pro)).toEqual(['role']);
    expect(gapHint('academic_info', pro)).toBe('Add role');
  });

  it('treats an em-dash as empty, not as an answer', () => {
    // The old screen wrote "—" into blank fields; that must not read as filled.
    expect(missingIn('personal_info', { profile: { name: '—' }, tenant: { date_of_birth: '' } }))
      .toEqual(['your name', 'date of birth']);
  });

  it('treats whitespace as empty', () => {
    expect(missingIn('personal_info', { profile: { name: '   ' }, tenant: {} }))
      .toContain('your name');
  });

  it('reads a phone from the contacts record when the profile has none', () => {
    const sources = { profile: {}, tenant: {}, contacts: { tenant_phone: { value: '+919999999999' } } };
    expect(missingIn('contact_info', sources)).toEqual(['email']);
  });

  it('counts every gap across the groups', () => {
    expect(totalGaps(GROUPS, speakcode)).toBe(2);
    expect(totalGaps(GROUPS, { profile: {}, tenant: {}, contacts: {} })).toBe(8);
    expect(totalGaps([], speakcode)).toBe(0);
  });

  it('has nothing to say about a group it does not know', () => {
    expect(gapHint('nonsense', speakcode)).toBeNull();
    expect(missingIn('nonsense', speakcode)).toEqual([]);
  });
});

describe('which card leads the page', () => {
  it('shows where someone lives once they live somewhere', () => {
    expect(heroMode({ hasLiveStay: true, identityComplete: false })).toBe('stay');
  });

  it('never shows the portable-profile pitch to someone who has moved in', () => {
    // They took the offer. Repeating it is the app talking to itself.
    expect(heroMode({ hasLiveStay: true, identityComplete: true })).toBe('stay');
  });

  it('pitches the portable profile to a seeker who has not filled it', () => {
    expect(heroMode({ hasLiveStay: false, identityComplete: false })).toBe('portable');
  });

  it('drops the pitch once a seeker has finished it', () => {
    expect(heroMode({ hasLiveStay: false, identityComplete: true })).toBe('none');
  });

  it('still pitches when completeness is unknown', () => {
    expect(heroMode({ hasLiveStay: false, identityComplete: null })).toBe('portable');
  });
});

describe('row meta', () => {
  it('shows a dash for none, so zero is not a number to interpret', () => {
    expect(countMeta(0)).toBe('—');
    expect(countMeta(null)).toBe('—');
    expect(countMeta(undefined)).toBe('—');
    expect(countMeta(3)).toBe('3');
  });

  it('pluralises stays and says something honest about none', () => {
    expect(stayMeta(0)).toBe('Nothing yet');
    expect(stayMeta(1)).toBe('1 stay');
    expect(stayMeta(4)).toBe('4 stays');
  });
});
