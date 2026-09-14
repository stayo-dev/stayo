import { describe, it, expect } from 'vitest';
import {
  RIM_OVERLAP_PERCENT,
  rimDogHeightPx,
  rimExposedHeightPx,
  rimCenteringOffsetPx,
} from './dogRimFit';

describe('rim geometry', () => {
  it('scales the dog by the rim view box, not the full one', () => {
    // 218 of the art's 300 units wide, so a 300px-wide dog is 218px tall.
    expect(rimDogHeightPx(300)).toBeCloseTo(218, 5);
    expect(rimDogHeightPx(184)).toBeCloseTo((184 * 218) / 300, 5);
  });

  it('hangs a small part of itself below the card edge', () => {
    // The paws straddle the edge: most of the dog is above it, a little below.
    expect(RIM_OVERLAP_PERCENT).toBeGreaterThan(0);
    expect(RIM_OVERLAP_PERCENT).toBeLessThan(15);
  });

  it('exposes less height than the dog is tall, by exactly the overlap', () => {
    const width = 184;
    const height = rimDogHeightPx(width);
    expect(rimExposedHeightPx(width)).toBeCloseTo(height * (1 - RIM_OVERLAP_PERCENT / 100), 5);
    expect(rimExposedHeightPx(width)).toBeLessThan(height);
  });

  /**
   * The bug this exists for: a dialog centred on its own leaves
   * `(viewport - card) / 2` above it, which is less than the dog needs, so the
   * dog's head is cut off by the top of the window. Shifting the card down by
   * half the exposed height centres the card *and* the dog as one unit.
   */
  it('offsets the card by half the exposed height, so the pair centres together', () => {
    const width = 184;
    expect(rimCenteringOffsetPx(width)).toBeCloseTo(rimExposedHeightPx(width) / 2, 5);
  });

  it('scales the offset with the dog, so a wider dog is given more room', () => {
    expect(rimCenteringOffsetPx(184)).toBeGreaterThan(rimCenteringOffsetPx(168));
  });

  it('asks for no room at all when there is no dog', () => {
    expect(rimCenteringOffsetPx(0)).toBe(0);
  });
});
