import { describe, expect, it } from 'vitest';
import { FORM_GAZE, THINKING_GAZE, armTransform, caretTarget, chooseGaze, headTiltFor, nextBlinkDelay, pupilOffset } from './dogGaze';

const EYE = { x: 130, y: 112 };

describe('pupilOffset', () => {
  it('rests centred when there is nothing to look at', () => {
    expect(pupilOffset(EYE, null, 3)).toEqual({ x: 0, y: 0 });
  });

  it('rests centred, rather than producing NaN, when the target is the eye itself', () => {
    expect(pupilOffset(EYE, EYE, 3)).toEqual({ x: 0, y: 0 });
  });

  it('travels the full range toward a far-away target, and no further', () => {
    const o = pupilOffset(EYE, { x: 1130, y: 112 }, 3);
    expect(o.x).toBeCloseTo(3, 6);
    expect(o.y).toBeCloseTo(0, 6);
  });

  it('travels proportionally less toward a nearby target', () => {
    // 60 units away is half of the 120-unit falloff, so half the range.
    const o = pupilOffset(EYE, { x: 190, y: 112 }, 3);
    expect(o.x).toBeCloseTo(1.5, 6);
  });

  it('points along the direction of the target', () => {
    // A 3-4-5 triangle scaled to 500 units: direction (0.6, 0.8).
    const o = pupilOffset(EYE, { x: 430, y: 512 }, 3);
    expect(o.x).toBeCloseTo(1.8, 6);
    expect(o.y).toBeCloseTo(2.4, 6);
  });
});

describe('headTiltFor', () => {
  it('holds the head level with no target', () => {
    expect(headTiltFor(null, 6)).toBe(0);
  });

  it('holds the head level for a target straight ahead', () => {
    expect(headTiltFor({ x: 150, y: 400 }, 6)).toBe(0);
  });

  it('eases toward the limit: 260 units right is tanh(1) of the maximum', () => {
    expect(headTiltFor({ x: 410, y: 128 }, 6)).toBeCloseTo(4.5696, 3);
  });

  it('never exceeds the maximum however far the cursor goes', () => {
    expect(headTiltFor({ x: 50_000, y: 128 }, 6)).toBeLessThanOrEqual(6);
    expect(headTiltFor({ x: 50_000, y: 128 }, 6)).toBeGreaterThan(5.99);
  });

  it('tilts the other way for a target on the left', () => {
    expect(headTiltFor({ x: -110, y: 128 }, 6)).toBeCloseTo(-4.5696, 3);
  });
});

describe('caretTarget', () => {
  const box = { left: 100, top: 200, width: 300, height: 44 };

  it('sits at the start of an empty field, inside its padding', () => {
    expect(caretTarget(box, { paddingLeft: 14, paddingRight: 14, textWidth: 0, scrollLeft: 0 })).toEqual({ x: 114, y: 222 });
  });

  it('follows the end of the typed text', () => {
    expect(caretTarget(box, { paddingLeft: 14, paddingRight: 14, textWidth: 90, scrollLeft: 0 })).toEqual({ x: 204, y: 222 });
  });

  it('stops at the inner right edge once the text overflows', () => {
    expect(caretTarget(box, { paddingLeft: 14, paddingRight: 44, textWidth: 900, scrollLeft: 0 })).toEqual({ x: 356, y: 222 });
  });

  it('accounts for the field having scrolled its text', () => {
    expect(caretTarget(box, { paddingLeft: 14, paddingRight: 14, textWidth: 400, scrollLeft: 150 })).toEqual({ x: 364, y: 222 });
  });
});

describe('armTransform', () => {
  it('stands the paw pad on its target when fully raised', () => {
    // Upright arm: the pad sits 104 units above the arm's origin.
    expect(armTransform({ raise: 1, lean: 0, padX: 130, padY: 112 })).toEqual({ x: 130, y: 216, rotate: 0 });
  });

  it('sinks the arm 130 units along its own axis when lowered', () => {
    expect(armTransform({ raise: 0, lean: 0, padX: 130, padY: 112 })).toEqual({ x: 130, y: 346, rotate: 0 });
  });

  it('sinks along the lean, not straight down', () => {
    // Leaning 90°: the arm lies horizontal, so lowering it slides it sideways.
    const t = armTransform({ raise: 0, lean: 90, padX: 130, padY: 112 });
    expect(t.x).toBeCloseTo(-104, 6);
    expect(t.y).toBeCloseTo(112, 6);
    expect(t.rotate).toBe(90);
  });
});

describe('nextBlinkDelay', () => {
  it('waits the base interval at the low end of the jitter', () => {
    expect(nextBlinkDelay(4, 0)).toBe(4000);
  });

  it('adds up to four seconds of jitter so blinks never feel metronomic', () => {
    expect(nextBlinkDelay(4, 0.5)).toBe(6000);
    expect(nextBlinkDelay(4, 0.999)).toBeLessThan(8000);
  });
});

describe('chooseGaze', () => {
  const pointer = { x: 900, y: 40 };
  const caret = { x: 520, y: 400 };
  const fieldCenter = { x: 600, y: 400 };
  const base = { animate: true, trackPointer: true, pointer, caret, fieldCenter };

  it('looks at nothing with its eyes covered or closed', () => {
    expect(chooseGaze('covering', base)).toBeNull();
    expect(chooseGaze('sleepy', base)).toBeNull();
  });

  it('looks up into its thought bubble while thinking, whatever the cursor does', () => {
    expect(chooseGaze('thinking', base)).toEqual(THINKING_GAZE);
  });

  it('reads along at the end of the typed text, not at the cursor', () => {
    expect(chooseGaze('reading', base)).toEqual({ space: 'screen', ...caret });
  });

  it('peeks at the password field itself', () => {
    expect(chooseGaze('peeking', base)).toEqual({ space: 'screen', ...fieldCenter });
  });

  it('follows the cursor when it is tracking one', () => {
    expect(chooseGaze('attentive', base)).toEqual({ space: 'screen', ...pointer });
  });

  it('watches the focused field on touch, where there is no cursor', () => {
    expect(chooseGaze('neutral', { ...base, trackPointer: false, pointer: null })).toEqual({ space: 'screen', ...fieldCenter });
  });

  it('looks down at the form when there is nothing more specific', () => {
    expect(chooseGaze('neutral', { ...base, trackPointer: false, pointer: null, fieldCenter: null })).toEqual(FORM_GAZE);
  });

  it('holds one calm gaze at the form under reduced motion, instead of darting after each keystroke', () => {
    expect(chooseGaze('reading', { ...base, animate: false })).toEqual(FORM_GAZE);
    expect(chooseGaze('attentive', { ...base, animate: false })).toEqual(FORM_GAZE);
  });
});
