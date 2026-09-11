/**
 * The Stayo confetti — brand-coloured pieces falling on `stayoConfettiFall`
 * (`styles/stayo-theme.css`).
 *
 * Deterministic rather than random: the same pieces every time, spread by the
 * golden angle so they never clump, and nothing to seed or mock in a test.
 * Shared by the two moments an owner finishes something large — completing
 * onboarding, and landing a bulk import — so they feel like the same product.
 */

export const CONFETTI_COLORS = ['#A45D44', '#D2986C', '#EBD9C4', '#1F8A5B', '#F4C67A'];

export interface ConfettiPiece {
  id: number;
  /** Horizontal start, as a percentage of the container. */
  left: number;
  size: number;
  /** Fall duration and start delay, in seconds. */
  dur: number;
  delay: number;
  rot: string;
  color: string;
  round: string;
}

export function buildConfetti(count = 46): ConfettiPiece[] {
  return Array.from({ length: count }, (_, i) => {
    const left = Math.round(((i * 137.5) % 100) + (i % 5) * 2);
    const size = 7 + (i % 4) * 3;
    const dur = 2.6 + (i % 5) * 0.5;
    const delay = (i % 9) * 0.18;
    const rot = `${i % 2 ? '' : '-'}${200 + (i % 5) * 140}deg`;
    const color = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
    const round = i % 3 === 0 ? '50%' : '2px';
    return { id: i, left, size, dur, delay, rot, color, round };
  });
}

/** When the last piece has landed — so the layer can be taken down, not left in the DOM. */
export function confettiDurationMs(pieces: ConfettiPiece[]): number {
  return Math.ceil(Math.max(0, ...pieces.map((p) => p.dur + p.delay)) * 1000);
}
