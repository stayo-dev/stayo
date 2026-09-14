import { describe, expect, it } from 'vitest';
import { activeFloorId, showLiftStrip } from './liftStrip';

describe('showLiftStrip', () => {
  it('only earns its space from three floors up', () => {
    expect([0, 1, 2, 3, 8].map(showLiftStrip)).toEqual([false, false, false, true, true]);
  });
});

describe('activeFloorId', () => {
  const bands = [
    { id: 'f3', top: -400 },
    { id: 'f2', top: -120 },
    { id: 'f1', top: 180 },
  ];

  it('is the last floor whose top has passed the line', () => expect(activeFloorId(bands, 60)).toBe('f2'));

  it('is the top floor before any has reached the line', () => {
    expect(
      activeFloorId(
        [
          { id: 'a', top: 300 },
          { id: 'b', top: 500 },
        ],
        60,
      ),
    ).toBe('a');
  });

  it('counts a floor sitting exactly on the line as reached', () => {
    expect(
      activeFloorId(
        [
          { id: 'a', top: -10 },
          { id: 'b', top: 60 },
        ],
        60,
      ),
    ).toBe('b');
  });

  it('is nothing when there are no floors', () => expect(activeFloorId([], 60)).toBeNull());

  describe('at the bottom of the building, where the lowest floors can never reach the line', () => {
    const bottom = [
      { id: 'f2', top: -300 },
      { id: 'f1', top: 90 },
      { id: 'g', top: 320 },
    ];

    it('lights the floor just tapped, not the one above it', () => {
      expect(activeFloorId(bottom, 60, { atEnd: true, requested: 'g' })).toBe('g');
      expect(activeFloorId(bottom, 60, { atEnd: true, requested: 'f1' })).toBe('f1');
    });

    it('lights the lowest floor when nothing was tapped', () => {
      expect(activeFloorId(bottom, 60, { atEnd: true })).toBe('g');
    });

    it('ignores a tap on a floor that is not in the building', () => {
      expect(activeFloorId(bottom, 60, { atEnd: true, requested: 'gone' })).toBe('g');
    });

    it('goes back to the line once the bottom is left', () => {
      expect(activeFloorId(bottom, 60, { atEnd: false, requested: 'g' })).toBe('f2');
    });
  });
});
