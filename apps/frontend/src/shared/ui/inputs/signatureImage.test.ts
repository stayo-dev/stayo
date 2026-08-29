import { describe, it, expect } from 'vitest';
import {
  otsuThreshold,
  luminanceHistogram,
  toLuminance,
  flattenIllumination,
  applyInkMask,
  fitWithin,
  validateSignatureFile,
  isPlausibleSignature,
  SIGNATURE_ACCEPTED_TYPES,
} from './signatureImage';

/** Builds RGBA pixel data from a per-pixel grey value. */
function greyImage(width: number, height: number, valueAt: (x: number, y: number) => number) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const v = Math.max(0, Math.min(255, Math.round(valueAt(x, y))));
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return data;
}

describe('otsuThreshold', () => {
  // The returned value is the top of the dark class: `applyInkMask` treats
  // `lum <= threshold` as ink. So the contract is that ink lands on or below
  // it and paper lands above it — not that it sits at the midpoint.
  it('separates ink from paper in the classic photographed-signature shape', () => {
    const hist = new Array(256).fill(0);
    hist[30] = 1000;
    hist[220] = 9000;

    const t = otsuThreshold(hist);
    expect(t).toBeGreaterThanOrEqual(30);
    expect(t).toBeLessThan(220);
  });

  it('finds the split without being told where to look', () => {
    // A dim indoor photo: everything darker, but still separable. A fixed
    // threshold of 127 would call the whole page ink; Otsu reads the histogram.
    const hist = new Array(256).fill(0);
    hist[10] = 800;
    hist[90] = 9000;

    const t = otsuThreshold(hist);
    expect(t).toBeGreaterThanOrEqual(10);
    expect(t).toBeLessThan(90);
    expect(t).toBeLessThan(127);
  });

  it('produces a threshold that actually classifies both modes correctly', () => {
    // The property that matters, asserted end-to-end rather than by bracket.
    const data = new Uint8ClampedArray([
      40, 40, 40, 255, // ink
      210, 210, 210, 255, // paper
    ]);
    const lum = toLuminance(data);
    const t = otsuThreshold(luminanceHistogram(lum));

    applyInkMask(data, lum, t);
    expect(data[0]).toBe(0);
    expect(data[4]).toBe(255);
  });

  it('returns a usable default rather than NaN for an empty histogram', () => {
    expect(otsuThreshold(new Array(256).fill(0))).toBe(127);
  });
});

describe('luminanceHistogram / toLuminance', () => {
  it('counts every pixel exactly once', () => {
    const lum = toLuminance(greyImage(10, 10, () => 200));
    const hist = luminanceHistogram(lum);
    expect(hist.reduce((a, b) => a + b, 0)).toBe(100);
    expect(hist[200]).toBe(100);
  });

  it('weights green most, matching perceived brightness', () => {
    const data = new Uint8ClampedArray([0, 255, 0, 255, 0, 0, 255, 255]);
    const lum = toLuminance(data);
    expect(lum[0]).toBeGreaterThan(lum[1]);
  });
});

describe('flattenIllumination', () => {
  it('removes a lighting gradient so one threshold works across the whole page', () => {
    // A page lit from the left: the right edge is in shadow. Global Otsu on
    // this raw would turn the shadowed corner into a black block.
    const w = 64;
    const h = 64;
    const raw = toLuminance(greyImage(w, h, (x) => 240 - x * 2));

    const flat = flattenIllumination(raw, w, h);

    const left = flat[32 * w + 2];
    const right = flat[32 * w + (w - 3)];
    expect(Math.abs(left - right)).toBeLessThan(20);
    expect(left).toBeGreaterThan(200);
    expect(right).toBeGreaterThan(200);
  });

  it('keeps a dark stroke dark relative to the page around it', () => {
    const w = 64;
    const h = 64;
    const raw = toLuminance(
      greyImage(w, h, (x, y) => (y >= 30 && y <= 33 ? 40 : 240 - x * 2)),
    );

    const flat = flattenIllumination(raw, w, h);

    const onStroke = flat[31 * w + 50];
    const offStroke = flat[10 * w + 50];
    expect(onStroke).toBeLessThan(offStroke - 80);
  });
});

describe('applyInkMask', () => {
  it('drives ink to black and paper to white', () => {
    const data = greyImage(4, 1, (x) => (x < 2 ? 20 : 230));
    const lum = toLuminance(data);

    const result = applyInkMask(data, lum, 128);

    expect([data[0], data[1], data[2], data[3]]).toEqual([0, 0, 0, 255]);
    expect([data[8], data[9], data[10], data[11]]).toEqual([255, 255, 255, 255]);
    expect(result).toEqual({ inkPixels: 2, totalPixels: 4 });
  });

  it('leaves nothing semi-transparent or grey — the page is composited onto white', () => {
    const data = greyImage(3, 3, () => 130);
    const lum = toLuminance(data);
    applyInkMask(data, lum, 128);

    for (let i = 0; i < data.length; i += 4) {
      expect([0, 255]).toContain(data[i]);
      expect(data[i + 3]).toBe(255);
    }
  });
});

describe('isPlausibleSignature', () => {
  it('rejects a blank page — nothing was captured', () => {
    expect(isPlausibleSignature(0, 10000)).toBe(false);
    expect(isPlausibleSignature(2, 10000)).toBe(false);
  });

  it('rejects a mostly-black frame — a lens cap or a badly underexposed shot', () => {
    expect(isPlausibleSignature(9000, 10000)).toBe(false);
  });

  it('accepts a normal signature, which covers a small part of the page', () => {
    expect(isPlausibleSignature(400, 10000)).toBe(true);
  });
});

describe('fitWithin', () => {
  it('leaves an already-small image untouched, never upscaling', () => {
    expect(fitWithin(400, 200, 1200)).toEqual({ width: 400, height: 200 });
  });

  it('scales the longest edge down and preserves the aspect ratio', () => {
    expect(fitWithin(4000, 2000, 1200)).toEqual({ width: 1200, height: 600 });
    expect(fitWithin(2000, 4000, 1200)).toEqual({ width: 600, height: 1200 });
  });

  it('never rounds an edge away to zero', () => {
    expect(fitWithin(5000, 3, 1200).height).toBe(1);
  });
});

describe('validateSignatureFile', () => {
  it('accepts each type the signature endpoint accepts', () => {
    for (const type of SIGNATURE_ACCEPTED_TYPES) {
      expect(validateSignatureFile({ type, size: 500_000 }).ok).toBe(true);
    }
  });

  it('rejects a file that is not one of those image types', () => {
    const result = validateSignatureFile({ type: 'application/pdf', size: 1000 });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain('photo');
  });

  it('accepts a large phone photo, because it is downscaled before upload', () => {
    // The server caps the *upload* at 2MB. Cleaning happens first and emits a
    // small PNG, so rejecting a 6MB camera photo here would reject the normal
    // case for a limit it never reaches.
    expect(validateSignatureFile({ type: 'image/jpeg', size: 6 * 1024 * 1024 }).ok).toBe(true);
  });

  it('still refuses something too large to decode comfortably on a phone', () => {
    const result = validateSignatureFile({ type: 'image/jpeg', size: 40 * 1024 * 1024 });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain('too large');
  });
});
