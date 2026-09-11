import { chooseUpload, fitWithin, isImage, OUTPUT_TYPE, outputName, QUALITY_LADDER, shouldReencode, UPLOAD_RULES, type UploadKind } from './uploadImagePolicy';

/**
 * Resizes and re-encodes an image on the device before it is uploaded — the
 * DOM half of `uploadImagePolicy.ts`, which makes every decision here and is
 * where the tests are.
 *
 * Never throws and never hangs: an image the browser cannot decode, or a
 * decode that stalls, resolves to the original file, and `uploadProblem()`
 * then tells the tenant plainly if that original cannot be sent. (The first
 * version of this had no error handler, so an undecodable photo left the
 * upload spinner running forever.) Non-images (PDFs) pass straight through.
 */

const DECODE_TIMEOUT_MS = 15_000;

type Decoded = { source: CanvasImageSource; width: number; height: number; release: () => void };

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('decode timed out')), ms);
    promise.then(
      (v) => {
        window.clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        window.clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/** `createImageBitmap` where available (fast, off the main thread, applies EXIF rotation); an `<img>` otherwise. */
async function decode(file: File): Promise<Decoded> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
    } catch {
      // Older Safari rejects the options bag, or the format; the <img> path below may still manage.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('image could not be decoded'));
      el.src = url;
    });
    // Browsers apply EXIF orientation to <img> by default, so naturalWidth/Height are already upright.
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, release: () => URL.revokeObjectURL(url) };
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }
}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, OUTPUT_TYPE, quality));
}

export async function prepareImageForUpload(file: File, kind: UploadKind): Promise<File> {
  if (!isImage(file.type)) return file;

  let decoded: Decoded | null = null;
  try {
    decoded = await withTimeout(decode(file), DECODE_TIMEOUT_MS);
    const dims = fitWithin(decoded.width, decoded.height, UPLOAD_RULES[kind].maxEdge);
    if (!shouldReencode(file, dims, kind)) return file;

    const canvas = document.createElement('canvas');
    canvas.width = dims.width;
    canvas.height = dims.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    // JPEG has no alpha: paint white first so a transparent PNG doesn't come out black.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, dims.width, dims.height);
    ctx.drawImage(decoded.source, 0, 0, dims.width, dims.height);

    let blob: Blob | null = null;
    for (const quality of QUALITY_LADDER) {
      blob = await toBlob(canvas, quality);
      if (!blob || blob.size <= UPLOAD_RULES[kind].targetBytes) break;
    }
    canvas.width = 0; // release the backing store promptly on memory-tight phones
    const candidate = blob && blob.type === OUTPUT_TYPE ? new File([blob], outputName(file.name), { type: OUTPUT_TYPE, lastModified: Date.now() }) : null;
    return chooseUpload(file, candidate, kind);
  } catch {
    return file;
  } finally {
    decoded?.release();
  }
}
