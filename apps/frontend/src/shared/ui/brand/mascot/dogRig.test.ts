import { describe, expect, it } from 'vitest';
import { DOG_EXPRESSIONS } from './dogExpressions';
import { REST_ARMS, rigTargets } from './dogRig';

const TUNE = { pupilRange: 3, headTiltMax: 6 };
const FAR_RIGHT = { x: 10_000, y: 112 };

describe('rigTargets', () => {
  it('looks toward the target: pupils right and head tilted right', () => {
    const t = rigTargets(DOG_EXPRESSIONS.neutral, FAR_RIGHT, TUNE, REST_ARMS);
    expect(t.pupils.l.x).toBeCloseTo(3, 3);
    expect(t.pupils.r.x).toBeCloseTo(3, 3);
    expect(t.headRotate).toBeCloseTo(6, 2);
  });

  it('ignores the target when covering: eyes are behind the paws, head holds still', () => {
    const t = rigTargets(DOG_EXPRESSIONS.covering, FAR_RIGHT, TUNE, REST_ARMS);
    expect(t.pupils.l).toEqual({ x: 0, y: 0 });
    expect(t.headRotate).toBe(0);
  });

  it('adds the expression tilt to the gaze tilt', () => {
    // thinking is tilted -8° in the art; a target straight ahead adds nothing.
    const t = rigTargets(DOG_EXPRESSIONS.thinking, { x: 150, y: 400 }, TUNE, REST_ARMS);
    expect(t.headRotate).toBeCloseTo(-8, 6);
  });

  it('keeps the expression tilt when sleeping, whatever the cursor does', () => {
    const t = rigTargets(DOG_EXPRESSIONS.sleepy, FAR_RIGHT, TUNE, REST_ARMS);
    expect(t.headRotate).toBe(4);
  });

  it('dips the head for reading', () => {
    const t = rigTargets(DOG_EXPRESSIONS.reading, null, TUNE, REST_ARMS);
    expect(t.headY).toBe(5);
  });

  it('droops the ears outward for concern and perks them inward for attention', () => {
    expect(rigTargets(DOG_EXPRESSIONS.concerned, null, TUNE, REST_ARMS).earSpread).toBe(12);
    expect(rigTargets(DOG_EXPRESSIONS.attentive, null, TUNE, REST_ARMS).earSpread).toBe(-5);
    expect(rigTargets(DOG_EXPRESSIONS.neutral, null, TUNE, REST_ARMS).earSpread).toBe(0);
  });

  it('raises both paws onto the eyes for covering', () => {
    const t = rigTargets(DOG_EXPRESSIONS.covering, null, TUNE, REST_ARMS);
    expect(t.arms.l).toEqual({ raise: 1, lean: 12, padX: 130, padY: 112 });
    expect(t.arms.r).toEqual({ raise: 1, lean: -12, padX: 170, padY: 112 });
  });

  it('lowers a paw along the lean it was raised on, so it sinks rather than swings', () => {
    const covering = rigTargets(DOG_EXPRESSIONS.covering, null, TUNE, REST_ARMS);
    const after = rigTargets(DOG_EXPRESSIONS.neutral, null, TUNE, covering.arms);
    expect(after.arms.l).toEqual({ raise: 0, lean: 12, padX: 130, padY: 112 });
  });

  it('switches pad targets between raised poses, from cover to cheer', () => {
    const covering = rigTargets(DOG_EXPRESSIONS.covering, null, TUNE, REST_ARMS);
    const cheer = rigTargets(DOG_EXPRESSIONS.celebrating, null, TUNE, covering.arms);
    expect(cheer.arms.l).toEqual({ raise: 1, lean: -22, padX: 72, padY: 108 });
  });

  it('widens the eyes for curiosity', () => {
    expect(rigTargets(DOG_EXPRESSIONS.curious, null, TUNE, REST_ARMS).eyeScale).toBe(1.15);
    expect(rigTargets(DOG_EXPRESSIONS.neutral, null, TUNE, REST_ARMS).eyeScale).toBe(1);
  });
});
