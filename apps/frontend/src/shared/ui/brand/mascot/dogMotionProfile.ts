/**
 * What the Stayo dog is allowed to do on this device.
 *
 * Modelled on `shouldEnableTrail` (`app/pages/discover/footprintTrail.ts`):
 * - a coarse pointer (a phone) has no cursor to follow, so the dog watches the
 *   focused field instead — but it still moves;
 * - `prefers-reduced-motion` is someone telling us motion makes the screen
 *   harder to use. That outranks the character: the dog holds still poses and
 *   swaps them instantly, and never tracks anything.
 *
 * PURE — no DOM, runs under vitest's node environment.
 */
export interface DogMotionProfile {
  /** Pupils and head follow the cursor. */
  trackPointer: boolean;
  /** Springs, blinks, wagging, breathing and the entrance run at all. */
  animate: boolean;
}

export function dogMotionProfile(input: { pointerFine: boolean; reducedMotion: boolean }): DogMotionProfile {
  const animate = !input.reducedMotion;
  return { trackPointer: animate && input.pointerFine, animate };
}
