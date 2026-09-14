/**
 * The Stayo dog's wave, as an angle over time.
 *
 * The raised paw is the designer's own (`paw-wave` in
 * `stayo-mascot-waving.svg`), and the angle here is added to that pose,
 * pivoting at the base of the leg — so the paw travels and the shoulder stays
 * put. A real wave comes in bursts: a few swings, a beat of rest with the paw
 * still up, then again. A steady sine forever reads as a metronome.
 *
 * Degrees, SVG sense: negative is counter-clockwise, which for the viewer's-left
 * paw means away from the face. The swing goes further out than in, so the
 * paw never crosses the eye.
 *
 * PURE — no DOM, runs under vitest's node environment.
 */
export const WAVE = {
  /** Base of the raised leg, in the leg's own (unrotated) drawing. */
  pivot: { x: 106, y: 240 },
  /** Let the paw finish rising before it swings. */
  delayS: 0.3,
  hz: 1.8,
  swings: 3,
  restS: 0.9,
  /** Half the swing, and how far its centre sits outward of the drawn pose. */
  amp: 10,
  offset: 4,
  /** Seconds to ease in and out of each burst. */
  easeS: 0.22,
} as const;

/** Swing angle, in degrees, `sinceS` seconds after the dog started waving. */
export function waveSwing(sinceS: number): number {
  const t = sinceS - WAVE.delayS;
  if (t < 0) return 0;
  const burstS = WAVE.swings / WAVE.hz;
  const phase = t % (burstS + WAVE.restS);
  if (phase >= burstS) return 0;
  const edge = Math.min(1, phase / WAVE.easeS, (burstS - phase) / WAVE.easeS);
  const envelope = edge * edge * (3 - 2 * edge);
  return -envelope * (WAVE.offset + WAVE.amp * Math.sin(2 * Math.PI * WAVE.hz * phase));
}
