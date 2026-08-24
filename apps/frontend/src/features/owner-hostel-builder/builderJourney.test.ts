import { describe, it, expect } from 'vitest';
import { builderJourney, continueBlocker } from './builderJourney';

describe('builderJourney', () => {
  it('never shows an empty bar on the first screen', () => {
    expect(builderJourney('name').percent).toBeGreaterThan(0);
  });

  it('names the floor being filled rather than a fraction of a step', () => {
    const at = builderJourney('fill', { activeIndex: 1, floorCount: 3, floorName: 'First floor' });
    expect(at.label).toBe('First floor · 2 of 3');
    expect(at.phase).toBe('Rooms');
  });

  it('falls back to a plain floor number when the floor has no name', () => {
    expect(builderJourney('fill', { activeIndex: 0, floorCount: 2 }).label).toBe('Floor 1 of 2');
  });

  // The old header divided the whole build into four steps, so a five-floor
  // building spent 60% of the work inside one of them.
  it('advances through the Rooms phase floor by floor', () => {
    const percents = [0, 1, 2, 3].map((i) => builderJourney('fill', { activeIndex: i, floorCount: 4 }).percent);
    expect(percents).toEqual([...percents].sort((a, b) => a - b));
    expect(new Set(percents).size).toBe(4);
  });

  it('moves forward at every stage boundary', () => {
    const seq = [
      builderJourney('name').percent,
      builderJourney('floors').percent,
      builderJourney('fill', { activeIndex: 0, floorCount: 3 }).percent,
      builderJourney('fill', { activeIndex: 2, floorCount: 3 }).percent,
      builderJourney('review').percent,
    ];
    expect(seq).toEqual([...seq].sort((a, b) => a - b));
    expect(seq[seq.length - 1]).toBe(100);
  });

  it('survives a floor count of zero without dividing by it', () => {
    const at = builderJourney('fill', { activeIndex: 0, floorCount: 0 });
    expect(Number.isFinite(at.percent)).toBe(true);
    expect(at.percent).toBeGreaterThanOrEqual(0);
    expect(at.percent).toBeLessThanOrEqual(100);
  });

  it('clamps an index past the end of the building', () => {
    expect(builderJourney('fill', { activeIndex: 9, floorCount: 3 }).label).toBe('Floor 3 of 3');
  });
});

describe('continueBlocker', () => {
  const base = { hostelName: 'Sunrise Residency', needsPassword: false, password: '', floorBlocker: null };

  it('says a name is needed instead of just dimming the button', () => {
    expect(continueBlocker('name', { ...base, hostelName: '   ' })).toBe('Enter a name to continue');
  });

  it('asks for the password only once the server has demanded one', () => {
    expect(continueBlocker('name', { ...base, needsPassword: false })).toBeNull();
    expect(continueBlocker('name', { ...base, needsPassword: true, password: '' })).toBe(
      'Confirm your password to continue',
    );
    expect(continueBlocker('name', { ...base, needsPassword: true, password: 'hunter2' })).toBeNull();
  });

  it('passes the floor blocker straight through on the Rooms step', () => {
    expect(continueBlocker('fill', { ...base, floorBlocker: 'Every room needs a number' })).toBe(
      'Every room needs a number',
    );
    expect(continueBlocker('fill', base)).toBeNull();
  });

  it('never blocks the Floors or Review steps', () => {
    expect(continueBlocker('floors', { ...base, hostelName: '' })).toBeNull();
    expect(continueBlocker('review', { ...base, floorBlocker: 'anything' })).toBeNull();
  });
});
