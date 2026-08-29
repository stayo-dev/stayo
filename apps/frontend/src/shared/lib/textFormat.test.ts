import { describe, it, expect } from 'vitest';
import {
  collapseSpaces,
  titleCaseText,
  titleCaseName,
  sentenceCaseText,
  capitalizeWordsLive,
} from './textFormat';

describe('collapseSpaces', () => {
  it('trims the ends and collapses runs in the middle', () => {
    expect(collapseSpaces('  idly   sambar  ')).toBe('idly sambar');
  });

  it('survives empty and nullish input', () => {
    expect(collapseSpaces('')).toBe('');
    expect(collapseSpaces('   ')).toBe('');
    expect(collapseSpaces(undefined as unknown as string)).toBe('');
  });
});

describe('titleCaseText', () => {
  it('capitalises what an owner types one-handed on a phone', () => {
    expect(titleCaseText('idly sambar')).toBe('Idly Sambar');
    expect(titleCaseText('  chicken   biryani ')).toBe('Chicken Biryani');
  });

  it('reads caps lock as an accident, not as emphasis', () => {
    // This ends up on a receipt and a tenant's agreement.
    expect(titleCaseText('GROUND FLOOR')).toBe('Ground Floor');
  });

  it('leaves deliberate internal capitals alone', () => {
    expect(titleCaseText('McDonald burger')).toBe('McDonald Burger');
    expect(titleCaseText('iPhone charger')).toBe('IPhone Charger');
  });

  it('capitalises across hyphens and slashes, keeping the separator', () => {
    expect(titleCaseText('sambar-rice')).toBe('Sambar-Rice');
    expect(titleCaseText('veg/non-veg')).toBe('Veg/Non-Veg');
  });

  it('never invents or drops characters', () => {
    expect(titleCaseText('dal 65')).toBe('Dal 65');
    expect(titleCaseText('chai ☕')).toBe('Chai ☕');
  });

  it('returns empty for empty input rather than a stray capital', () => {
    expect(titleCaseText('   ')).toBe('');
  });
});

describe('titleCaseName', () => {
  it('tidies a name typed in a hurry', () => {
    expect(titleCaseName('ramesh kumar')).toBe('Ramesh Kumar');
    expect(titleCaseName('  PRIYA   S ')).toBe('Priya S');
  });

  it('keeps particles lowercase inside a name but not at the start', () => {
    expect(titleCaseName('ramesh bin abdullah')).toBe('Ramesh bin Abdullah');
    expect(titleCaseName('de souza')).toBe('De Souza');
  });

  it('does not mangle a name whose owner capitalised it deliberately', () => {
    expect(titleCaseName('McCarthy')).toBe('McCarthy');
    expect(titleCaseName('DeSouza')).toBe('DeSouza');
  });

  it('leaves a single-word name alone but for its first letter', () => {
    expect(titleCaseName('arjun')).toBe('Arjun');
  });
});

describe('sentenceCaseText', () => {
  it('capitalises only the first letter, leaving the sentence readable', () => {
    expect(sentenceCaseText('please pay rent by the fifth')).toBe('Please pay rent by the fifth');
  });

  it('does not title-case a sentence into machine-speak', () => {
    expect(sentenceCaseText('no guests after 10 pm')).not.toBe('No Guests After 10 Pm');
  });

  it('leaves an already-capitalised sentence unchanged', () => {
    expect(sentenceCaseText('Rent is due monthly.')).toBe('Rent is due monthly.');
  });

  it('returns empty for whitespace', () => {
    expect(sentenceCaseText('  ')).toBe('');
  });
});

describe('capitalizeWordsLive', () => {
  it('capitalises each word as it is typed', () => {
    expect(capitalizeWordsLive('gas cylinder')).toBe('Gas Cylinder');
  });

  it('never changes the length, so the caret cannot jump', () => {
    for (const input of ['gas', 'gas ', 'gas cyl', '  a b  ']) {
      expect(capitalizeWordsLive(input)).toHaveLength(input.length);
    }
  });

  it('keeps a trailing space, so the next word can actually be typed', () => {
    // The reason this is separate from titleCaseText, which would trim it and
    // make the space impossible to enter.
    expect(capitalizeWordsLive('gas ')).toBe('Gas ');
  });

  it('leaves casing typed mid-word alone', () => {
    expect(capitalizeWordsLive('iPhone charger')).toBe('IPhone Charger');
  });
});
