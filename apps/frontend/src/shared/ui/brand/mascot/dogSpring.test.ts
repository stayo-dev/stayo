import { describe, expect, it } from 'vitest';
import { stepSpring, type SpringState } from './dogSpring';

/** Runs the spring at 60fps for `seconds`, returning every position it passed through. */
function run(start: SpringState, target: number, k: number, zeta: number, seconds: number): number[] {
  const trail: number[] = [];
  let s = start;
  for (let i = 0; i < Math.round(seconds * 60); i++) {
    s = stepSpring(s, target, k, zeta, 1 / 60);
    trail.push(s.x);
  }
  return trail;
}

describe('stepSpring', () => {
  it('stays put when already resting on its target', () => {
    expect(stepSpring({ x: 5, v: 0 }, 5, 170, 0.72, 1 / 60)).toEqual({ x: 5, v: 0 });
  });

  it('settles on the target within two seconds', () => {
    const trail = run({ x: 0, v: 0 }, 10, 170, 0.72, 2);
    expect(trail[trail.length - 1]).toBeCloseTo(10, 2);
  });

  it('overshoots a little when underdamped, which is what reads as alive', () => {
    const trail = run({ x: 0, v: 0 }, 10, 170, 0.72, 2);
    expect(Math.max(...trail)).toBeGreaterThan(10.05);
  });

  it('never overshoots when critically damped', () => {
    const trail = run({ x: 0, v: 0 }, 10, 170, 1, 2);
    expect(Math.max(...trail)).toBeLessThanOrEqual(10.0001);
  });

  it('a stiffer spring gets closer to the target in the same time', () => {
    const soft = run({ x: 0, v: 0 }, 10, 60, 1, 0.15);
    const stiff = run({ x: 0, v: 0 }, 10, 400, 1, 0.15);
    expect(stiff[stiff.length - 1]).toBeGreaterThan(soft[soft.length - 1]);
  });

  it('stays stable through a long frame (a backgrounded tab resuming)', () => {
    const s = stepSpring({ x: 0, v: 0 }, 10, 400, 0.72, 0.5);
    expect(Number.isFinite(s.x)).toBe(true);
    expect(Math.abs(s.x)).toBeLessThan(20);
  });
});
