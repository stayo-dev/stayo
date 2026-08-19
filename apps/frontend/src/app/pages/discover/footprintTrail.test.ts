import { describe, expect, it } from 'vitest';
import {
  MAX_PRINTS,
  STEP_DISTANCE,
  nextFootprint,
  shouldEnableTrail,
  trimTrail,
  type Footprint,
} from './footprintTrail';

describe('shouldEnableTrail', () => {
  const on = { pointerFine: true, reducedMotion: false, viewportWidth: 1440 };

  it('runs on a laptop with a mouse', () => {
    expect(shouldEnableTrail(on)).toBe(true);
  });

  it('never runs on a touch device — there is no cursor to follow', () => {
    expect(shouldEnableTrail({ ...on, pointerFine: false })).toBe(false);
  });

  it('obeys prefers-reduced-motion', () => {
    // Someone telling the OS that motion makes screens harder to use outranks
    // a decoration.
    expect(shouldEnableTrail({ ...on, reducedMotion: true })).toBe(false);
  });

  it('stays off on narrow viewports, where the page has no margins to live in', () => {
    expect(shouldEnableTrail({ ...on, viewportWidth: 900 })).toBe(false);
  });
});

describe('nextFootprint', () => {
  it('waits for a full stride before leaving a print', () => {
    expect(nextFootprint({ x: 0, y: 0 }, { x: STEP_DISTANCE - 1, y: 0 }, null, 1)).toBeNull();
    expect(nextFootprint({ x: 0, y: 0 }, { x: STEP_DISTANCE + 1, y: 0 }, null, 1)).not.toBeNull();
  });

  it('leaves nothing on the first move, with no previous position', () => {
    expect(nextFootprint(null, { x: 100, y: 100 }, null, 1)).toBeNull();
  });

  it('alternates feet', () => {
    const first = nextFootprint({ x: 0, y: 0 }, { x: 200, y: 0 }, null, 1)!;
    const second = nextFootprint({ x: 200, y: 0 }, { x: 400, y: 0 }, first, 2)!;
    const third = nextFootprint({ x: 400, y: 0 }, { x: 600, y: 0 }, second, 3)!;
    expect([first.side, second.side, third.side]).toEqual(['left', 'right', 'left']);
  });

  it('offsets each foot to its own side of the path', () => {
    // Walking straight right: left foot sits above the path, right below.
    const left = nextFootprint({ x: 0, y: 0 }, { x: 200, y: 0 }, null, 1)!;
    const right = nextFootprint({ x: 200, y: 0 }, { x: 400, y: 0 }, left, 2)!;
    expect(left.y).toBeLessThan(0);
    expect(right.y).toBeGreaterThan(0);
  });

  it('points the toes the way the cursor went', () => {
    expect(nextFootprint({ x: 0, y: 0 }, { x: 200, y: 0 }, null, 1)!.angle).toBe(90);
    expect(nextFootprint({ x: 0, y: 0 }, { x: 0, y: 200 }, null, 1)!.angle).toBe(180);
  });
});

describe('trimTrail', () => {
  const print = (id: number): Footprint => ({ id, x: 0, y: 0, angle: 0, side: 'left' });

  it('keeps the trail bounded, dropping the oldest', () => {
    const trail = trimTrail(Array.from({ length: MAX_PRINTS + 3 }, (_u, i) => print(i)));
    expect(trail).toHaveLength(MAX_PRINTS);
    expect(trail[0].id).toBe(3);
  });

  it('leaves a short trail alone', () => {
    expect(trimTrail([print(1), print(2)])).toHaveLength(2);
  });
});
