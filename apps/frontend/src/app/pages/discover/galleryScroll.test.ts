import { describe, expect, it } from 'vitest';
import { photoIndexFromScroll } from './galleryScroll';

describe('photoIndexFromScroll', () => {
  it('reports the photo filling the track', () => {
    expect(photoIndexFromScroll(0, 390, 4)).toBe(0);
    expect(photoIndexFromScroll(390, 390, 4)).toBe(1);
    expect(photoIndexFromScroll(1170, 390, 4)).toBe(3);
  });

  it('settles on the nearer photo mid-swipe', () => {
    expect(photoIndexFromScroll(150, 390, 4)).toBe(0);
    expect(photoIndexFromScroll(240, 390, 4)).toBe(1);
  });

  it('never indexes past the last photo when the track overscrolls', () => {
    expect(photoIndexFromScroll(2000, 390, 3)).toBe(2);
    expect(photoIndexFromScroll(-60, 390, 3)).toBe(0);
  });

  it('returns the first photo before the track has been laid out', () => {
    expect(photoIndexFromScroll(0, 0, 4)).toBe(0);
    expect(photoIndexFromScroll(120, Number.NaN, 4)).toBe(0);
  });

  it('handles a hostel with no photos', () => {
    expect(photoIndexFromScroll(0, 390, 0)).toBe(0);
  });
});
