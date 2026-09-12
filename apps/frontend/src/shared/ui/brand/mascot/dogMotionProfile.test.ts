import { describe, expect, it } from 'vitest';
import { dogMotionProfile } from './dogMotionProfile';

describe('dogMotionProfile', () => {
  it('tracks the cursor and animates for a mouse user who allows motion', () => {
    expect(dogMotionProfile({ pointerFine: true, reducedMotion: false })).toEqual({ trackPointer: true, animate: true });
  });

  it('does not track a touch pointer, which has no cursor to follow, but still animates', () => {
    expect(dogMotionProfile({ pointerFine: false, reducedMotion: false })).toEqual({ trackPointer: false, animate: true });
  });

  it('neither tracks nor animates under reduced motion, even with a mouse', () => {
    expect(dogMotionProfile({ pointerFine: true, reducedMotion: true })).toEqual({ trackPointer: false, animate: false });
  });

  it('neither tracks nor animates for a touch user who asked for reduced motion', () => {
    expect(dogMotionProfile({ pointerFine: false, reducedMotion: true })).toEqual({ trackPointer: false, animate: false });
  });
});
