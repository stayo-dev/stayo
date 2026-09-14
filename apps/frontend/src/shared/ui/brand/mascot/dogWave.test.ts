import { describe, expect, it } from 'vitest';
import { DOG_EXPRESSIONS } from './dogExpressions';
import { REST_ARMS, rigTargets } from './dogRig';
import { WAVE, waveSwing } from './dogWave';

const PERIOD_S = WAVE.swings / WAVE.hz + WAVE.restS;
const BURST_S = WAVE.swings / WAVE.hz;
const sample = (from: number, to: number, stepS = 0.001) => {
  const out: number[] = [];
  for (let t = from; t <= to; t += stepS) out.push(waveSwing(t));
  return out;
};

describe('waveSwing', () => {
  it('holds still while the paw is still rising', () => {
    expect(waveSwing(0)).toBe(0);
    expect(waveSwing(WAVE.delayS - 0.01)).toBe(0);
  });

  it('rests at exactly the designer’s raised pose between bursts', () => {
    const restMid = WAVE.delayS + BURST_S + WAVE.restS / 2;
    expect(waveSwing(restMid)).toBe(0);
  });

  it('swings further outward, away from the face, than inward across it', () => {
    const burst = sample(WAVE.delayS, WAVE.delayS + BURST_S);
    // Negative is counter-clockwise: the viewer's-left paw moving away from the head.
    expect(Math.min(...burst)).toBeLessThan(-(WAVE.offset + WAVE.amp) + 1);
    expect(Math.max(...burst)).toBeGreaterThan(WAVE.amp - WAVE.offset - 1);
    expect(Math.min(...burst)).toBeGreaterThanOrEqual(-(WAVE.offset + WAVE.amp));
    expect(Math.max(...burst)).toBeLessThanOrEqual(WAVE.amp - WAVE.offset);
  });

  it('never jumps: eases into and out of every burst', () => {
    const s = sample(0, WAVE.delayS + 2 * PERIOD_S);
    let worst = 0;
    for (let i = 1; i < s.length; i++) worst = Math.max(worst, Math.abs(s[i] - s[i - 1]));
    // 1ms apart; a 2Hz sine of amplitude 14 moves ~0.18°/ms at its fastest.
    expect(worst).toBeLessThan(0.2);
  });

  it('repeats burst after burst', () => {
    const t = WAVE.delayS + 0.37;
    expect(waveSwing(t + PERIOD_S)).toBeCloseTo(waveSwing(t), 9);
    expect(waveSwing(t + 3 * PERIOD_S)).toBeCloseTo(waveSwing(t), 9);
  });
});

describe('waving', () => {
  it('raises the viewer’s-left paw, as in stayo-mascot-waving.svg', () => {
    expect(DOG_EXPRESSIONS.waving.arms).toEqual(['wave', 'down']);
  });

  it('keeps both forearms down — the waving paw is its own art, not a stretched forearm', () => {
    const t = rigTargets(DOG_EXPRESSIONS.waving, null, { pupilRange: 3, headTiltMax: 6 }, REST_ARMS);
    expect(t.arms.l.raise).toBe(0);
    expect(t.arms.r.raise).toBe(0);
  });
});
