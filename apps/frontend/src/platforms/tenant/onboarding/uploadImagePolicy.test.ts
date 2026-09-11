import { describe, expect, it } from 'vitest';
import { chooseUpload, fitWithin, outputName, shouldReencode, UPLOAD_RULES, uploadProblem } from './uploadImagePolicy';

const MB = 1024 * 1024;

describe('fitWithin', () => {
  it('scales a 12MP portrait photo down to the longest edge', () => {
    expect(fitWithin(3024, 4032, 1280)).toEqual({ width: 960, height: 1280 });
  });
  it('scales landscape by width', () => {
    expect(fitWithin(4000, 3000, 2200)).toEqual({ width: 2200, height: 1650 });
  });
  it('never upscales a small image', () => {
    expect(fitWithin(800, 600, 1280)).toEqual({ width: 800, height: 600 });
  });
});

describe('shouldReencode', () => {
  it('re-encodes a typical camera photo', () => {
    expect(shouldReencode({ type: 'image/jpeg', size: 4.2 * MB }, { width: 3024, height: 4032 }, 'photo')).toBe(true);
  });
  it('re-encodes a small file that is still too large in pixels', () => {
    expect(shouldReencode({ type: 'image/jpeg', size: 300 * 1024 }, { width: 4000, height: 3000 }, 'photo')).toBe(true);
  });
  it('re-encodes a format the server does not accept, however small', () => {
    expect(shouldReencode({ type: 'image/heic', size: 90 * 1024 }, { width: 800, height: 600 }, 'document')).toBe(true);
  });
  it('leaves a small, right-sized, accepted image alone', () => {
    expect(shouldReencode({ type: 'image/jpeg', size: 250 * 1024 }, { width: 1000, height: 800 }, 'photo')).toBe(false);
  });
});

describe('chooseUpload', () => {
  const original = { type: 'image/png', size: 900 * 1024 };
  it('takes the re-encode when it is smaller', () => {
    const candidate = { type: 'image/jpeg', size: 200 * 1024 };
    expect(chooseUpload(original, candidate, 'photo')).toBe(candidate);
  });
  it('keeps the original when re-encoding made it bigger', () => {
    const candidate = { type: 'image/jpeg', size: 1.1 * MB };
    expect(chooseUpload(original, candidate, 'photo')).toBe(original);
  });
  it('always takes the re-encode of a format the server rejects', () => {
    const heic = { type: 'image/heic', size: 100 * 1024 };
    const candidate = { type: 'image/jpeg', size: 400 * 1024 };
    expect(chooseUpload(heic, candidate, 'photo')).toBe(candidate);
  });
  it('falls back to the original when the image could not be decoded', () => {
    expect(chooseUpload(original, null, 'photo')).toBe(original);
  });
});

describe('outputName', () => {
  it.each([
    ['IMG_2041.HEIC', 'IMG_2041.jpg'],
    ['aadhaar.front.png', 'aadhaar.front.jpg'],
    ['scan', 'scan.jpg'],
    ['', 'upload.jpg'],
  ])('%s → %s', (input, expected) => {
    expect(outputName(input)).toBe(expected);
  });
});

describe('uploadProblem — mirrors the server routes', () => {
  it('accepts what the photo route accepts', () => {
    expect(uploadProblem({ type: 'image/jpeg', size: 1.9 * MB }, 'photo')).toBeNull();
  });
  it('refuses a photo over the 2MB server limit', () => {
    expect(uploadProblem({ type: 'image/jpeg', size: 2.1 * MB }, 'photo')).toMatch(/over 2MB/);
  });
  it('refuses a PDF as a profile photo', () => {
    expect(uploadProblem({ type: 'application/pdf', size: 100 * 1024 }, 'photo')).toMatch(/Choose a photo/);
  });
  it('accepts a PDF document up to 5MB, and says what to do above it', () => {
    expect(uploadProblem({ type: 'application/pdf', size: 4 * MB }, 'document')).toBeNull();
    expect(uploadProblem({ type: 'application/pdf', size: 6 * MB }, 'document')).toMatch(/Upload a photo of the document/);
  });
  it('names an undecodable image format rather than a generic error', () => {
    expect(uploadProblem({ type: 'image/heic', size: 1 * MB }, 'document')).toMatch(/format can't be used/);
  });
  it('keeps the compression target inside the server limit for both kinds', () => {
    for (const rule of Object.values(UPLOAD_RULES)) expect(rule.targetBytes).toBeLessThan(rule.maxBytes);
  });
});
