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
});
