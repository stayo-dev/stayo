import { describe, expect, it } from 'vitest';
import { MAX_PIXEL_RATIO, pdfPageScale } from './pdfScale';

describe('pdfPageScale', () => {
  it('fits an A4 page (595pt) to the container width', () => {
    expect(pdfPageScale(340, 595, 1).cssScale).toBeCloseTo(340 / 595);
  });

  it('renders at the device pixel ratio so text is sharp', () => {
    const { cssScale, pixelScale } = pdfPageScale(340, 595, 2);
    expect(pixelScale).toBeCloseTo(cssScale * 2);
  });

  it('caps the pixel ratio to keep long agreements light', () => {
    const { cssScale, pixelScale } = pdfPageScale(340, 595, 3.5);
    expect(pixelScale).toBeCloseTo(cssScale * MAX_PIXEL_RATIO);
  });

  it('never renders below 1x', () => {
    const { cssScale, pixelScale } = pdfPageScale(340, 595, 0.5);
    expect(pixelScale).toBeCloseTo(cssScale);
  });

  it('falls back to 1 for a zero-width container or page', () => {
    expect(pdfPageScale(0, 595, 2)).toEqual({ cssScale: 1, pixelScale: 1 });
    expect(pdfPageScale(340, 0, 2)).toEqual({ cssScale: 1, pixelScale: 1 });
  });
});
