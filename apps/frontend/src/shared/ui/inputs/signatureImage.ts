/**
 * Turning a photograph of a signature on paper into something that can sit on
 * a legal document.
 *
 * An owner photographing their signature produces a grey, shadowed rectangle:
 * the paper is never white, the phone casts a shadow across it, and the
 * exposure varies with the room. The agreement PDF composites the signature
 * onto a white page, so uploading that photo untouched puts a visibly pasted-on
 * grey block in the corner of every tenant's agreement for that hostel.
 *
 * Everything here is pure arithmetic over pixel data — no service, no API key,
 * no library. It runs in the browser rather than on the server for one
 * practical reason: the signature endpoint caps uploads at 2MB and a modern
 * phone photo is 3–8MB, so cleaning and downscaling client-side means the limit
 * is never reached, and a bad result costs a retap rather than a round trip.
 * See ADR-140.
 *
 * The canvas glue lives in `SignaturePad.tsx`; this module takes plain arrays
 * so it can be tested without a DOM.
 */

/** Exactly what `POST /api/owner/hostels/[id]/agreement-template/signature` accepts. */
export const SIGNATURE_ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

/**
 * Ceiling on what we will decode, not on what we will upload. The server's own
 * 2MB limit applies to the cleaned PNG we emit, which is far smaller; this
 * exists only so a phone is never asked to decode something absurd.
 */
export const SIGNATURE_MAX_INPUT_BYTES = 25 * 1024 * 1024;

/** Long edge of the cleaned image. Plenty for print, small on the wire. */
export const SIGNATURE_MAX_EDGE = 1200;

/**
 * Not a discriminated union: this app compiles with `strict: false`, under
 * which TypeScript will not narrow `{ ok: true } | { ok: false; reason }` on
 * `!check.ok`, so callers could not reach `reason` at all.
 */
export interface SignatureFileCheck {
  ok: boolean;
  /** Present, and safe to show the owner, whenever `ok` is false. */
  reason?: string;
}

export function validateSignatureFile(file: { type: string; size: number }): SignatureFileCheck {
  if (!SIGNATURE_ACCEPTED_TYPES.includes(file.type as (typeof SIGNATURE_ACCEPTED_TYPES)[number])) {
    return { ok: false, reason: 'Choose a photo — JPG, PNG or WebP.' };
  }
  if (file.size > SIGNATURE_MAX_INPUT_BYTES) {
    return { ok: false, reason: 'That photo is too large. Try one taken at a normal size.' };
  }
  return { ok: true };
}

/** Perceived brightness per pixel, one byte each, from RGBA input. */
export function toLuminance(data: Uint8ClampedArray): Uint8Array {
  const out = new Uint8Array(data.length / 4);
  for (let p = 0, i = 0; i < data.length; i += 4, p += 1) {
    out[p] = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
  }
  return out;
}

export function luminanceHistogram(lum: Uint8Array): number[] {
  const hist = new Array(256).fill(0);
  for (let i = 0; i < lum.length; i += 1) hist[lum[i]] += 1;
  return hist;
}

/**
 * Otsu's method: choose the threshold that best separates the pixels into two
 * groups, by maximising the variance *between* them.
 *
 * The point of computing it rather than hardcoding 127 is that a dim indoor
 * photo and a bright one have completely different paper values — a fixed
 * threshold turns one of them entirely black or entirely white.
 */
export function otsuThreshold(histogram: number[]): number {
  const total = histogram.reduce((a, b) => a + b, 0);
  if (total === 0) return 127;

  let sum = 0;
  for (let i = 0; i < 256; i += 1) sum += i * histogram[i];

  let sumB = 0;
  let weightB = 0;
  let best = -1;
  let threshold = 127;

  for (let t = 0; t < 256; t += 1) {
    weightB += histogram[t];
    if (weightB === 0) continue;
    const weightF = total - weightB;
    if (weightF === 0) break;

    sumB += t * histogram[t];
    const meanB = sumB / weightB;
    const meanF = (sum - sumB) / weightF;
    const between = weightB * weightF * (meanB - meanF) * (meanB - meanF);

    if (between > best) {
      best = between;
      threshold = t;
    }
  }

  return threshold;
}

/** Blocks across the long edge when estimating the lighting across a page. */
const BACKGROUND_BLOCKS = 12;
/** Per block, the paper is taken to be near the brightest thing in it. */
const PAPER_PERCENTILE = 0.9;

/**
 * Divides out uneven lighting, so one global threshold works everywhere.
 *
 * Without this, a hand or phone shadow across one corner drops that corner
 * below the threshold and it thresholds to a solid black block — the single
 * most common way a photographed signature comes out unusable. The page is
 * split into a coarse grid, a high percentile of each block is taken as "what
 * paper looks like *here*", that estimate is interpolated smoothly across the
 * image, and each pixel is re-expressed as a fraction of its local paper.
 *
 * The percentile rather than the max is deliberate: a single blown-out
 * specular highlight would otherwise define the whole block.
 */
export function flattenIllumination(lum: Uint8Array, width: number, height: number): Uint8Array {
  if (width <= 0 || height <= 0) return lum;

  const cols = Math.max(1, Math.min(BACKGROUND_BLOCKS, width));
  const rows = Math.max(1, Math.min(BACKGROUND_BLOCKS, height));
  const blockW = width / cols;
  const blockH = height / rows;

  // Per-block estimate of the paper's brightness.
  const paper = new Float32Array(cols * rows);
  const bucket: number[] = [];
  for (let by = 0; by < rows; by += 1) {
    for (let bx = 0; bx < cols; bx += 1) {
      bucket.length = 0;
      const x0 = Math.floor(bx * blockW);
      const x1 = Math.min(width, Math.ceil((bx + 1) * blockW));
      const y0 = Math.floor(by * blockH);
      const y1 = Math.min(height, Math.ceil((by + 1) * blockH));
      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) bucket.push(lum[y * width + x]);
      }
      if (bucket.length === 0) {
        paper[by * cols + bx] = 255;
        continue;
      }
      bucket.sort((a, b) => a - b);
      const idx = Math.min(bucket.length - 1, Math.floor(bucket.length * PAPER_PERCENTILE));
      // Never divide by something near zero: a wholly black block would send
      // its neighbours to pure white.
      paper[by * cols + bx] = Math.max(1, bucket[idx]);
    }
  }

  // Bilinear sample of that estimate, so blocks don't show as visible seams.
  const out = new Uint8Array(lum.length);
  for (let y = 0; y < height; y += 1) {
    const fy = Math.min(rows - 1, Math.max(0, (y + 0.5) / blockH - 0.5));
    const y0 = Math.floor(fy);
    const y1 = Math.min(rows - 1, y0 + 1);
    const wy = fy - y0;

    for (let x = 0; x < width; x += 1) {
      const fx = Math.min(cols - 1, Math.max(0, (x + 0.5) / blockW - 0.5));
      const x0 = Math.floor(fx);
      const x1 = Math.min(cols - 1, x0 + 1);
      const wx = fx - x0;

      const top = paper[y0 * cols + x0] * (1 - wx) + paper[y0 * cols + x1] * wx;
      const bottom = paper[y1 * cols + x0] * (1 - wx) + paper[y1 * cols + x1] * wx;
      const local = top * (1 - wy) + bottom * wy;

      const normalised = (lum[y * width + x] / local) * 255;
      out[y * width + x] = normalised > 255 ? 255 : normalised < 0 ? 0 : Math.round(normalised);
    }
  }

  return out;
}

/**
 * Writes the two-tone result back over the RGBA data, in place.
 *
 * Fully black or fully white with no partial alpha, matching what the drawn
 * canvas produces — the agreement renders the signature onto a white page, so
 * a half-transparent stroke would composite differently there than it looks
 * here.
 */
export function applyInkMask(
  data: Uint8ClampedArray,
  lum: Uint8Array,
  threshold: number,
): { inkPixels: number; totalPixels: number } {
  let inkPixels = 0;

  for (let p = 0, i = 0; i < data.length; i += 4, p += 1) {
    const ink = lum[p] <= threshold;
    if (ink) inkPixels += 1;
    const v = ink ? 0 : 255;
    data[i] = v;
    data[i + 1] = v;
    data[i + 2] = v;
    data[i + 3] = 255;
  }

  return { inkPixels, totalPixels: data.length / 4 };
}

/**
 * Whether the cleaned result plausibly holds a signature.
 *
 * Otsu always finds *a* split, including on a blank sheet or a photo of the
 * inside of a pocket — it has no notion of "there was nothing here". These two
 * bounds catch both ends so the owner is told to retake the photo rather than
 * silently signing every future agreement with a black rectangle.
 */
export function isPlausibleSignature(inkPixels: number, totalPixels: number): boolean {
  if (totalPixels <= 0) return false;
  const ratio = inkPixels / totalPixels;
  return ratio >= 0.0005 && ratio <= 0.6;
}

/** Downscale to fit a square bound, preserving aspect ratio and never upscaling. */
export function fitWithin(width: number, height: number, max: number): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= max) return { width, height };
  const scale = max / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}
