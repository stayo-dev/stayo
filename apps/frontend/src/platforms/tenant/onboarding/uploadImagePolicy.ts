/**
 * What an onboarding upload must look like before it leaves the phone — the
 * pure half of `prepareImageForUpload` (compressImage.ts), tested without a DOM.
 *
 * Phone cameras produce 3-8MB photos. Uploading those over mobile data is the
 * slow part of onboarding, and the server caps a profile photo at 2MB, so an
 * untouched camera photo was refused outright. Images are therefore resized and
 * re-encoded on the device first; the server limits below mirror
 * `app/api/tenants/activate/{photo,documents}/route.ts` so a file this module
 * passes is a file the server accepts.
 *
 * Output is always JPEG. Every browser can encode it (Safari before 16 cannot
 * encode WebP and silently returns a PNG — often larger than the original),
 * and a KYC document an owner downloads, forwards or prints should open
 * anywhere.
 */

export type UploadKind = 'photo' | 'document';

type Rule = {
  /** Longest edge after resizing, px. */
  maxEdge: number;
  /** Stop lowering quality once the file is this small. */
  targetBytes: number;
  /** The server's hard limit. */
  maxBytes: number;
  /** MIME types the server accepts. */
  accepts: readonly string[];
};

const MB = 1024 * 1024;

export const UPLOAD_RULES: Record<UploadKind, Rule> = {
  // Shown as an avatar and to staff at the desk — recognisable, not archival.
  photo: { maxEdge: 1280, targetBytes: 400 * 1024, maxBytes: 2 * MB, accepts: ['image/jpeg', 'image/png', 'image/webp'] },
  // Aadhaar / college ID: the owner has to read the small print, so keep it large.
  document: { maxEdge: 2200, targetBytes: 1.2 * MB, maxBytes: 5 * MB, accepts: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] },
};

/** JPEG qualities tried in order until the result is under `targetBytes`. */
export const QUALITY_LADDER = [0.85, 0.75, 0.65] as const;

export const OUTPUT_TYPE = 'image/jpeg';

type FileLike = { type: string; size: number; name?: string };

export function isImage(type: string): boolean {
  return type.startsWith('image/');
}

/** Scales down to fit `maxEdge` on the longest side, never up. */
export function fitWithin(width: number, height: number, maxEdge: number): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width, height };
  const scale = maxEdge / longest;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/**
 * Whether an image is worth re-encoding. A small, already-accepted file of the
 * right dimensions is sent as it is — re-encoding it would only cost quality.
 * Anything the server would not accept as-is (e.g. HEIC, which Safari can
 * decode) is always converted.
 */
export function shouldReencode(file: FileLike, dims: { width: number; height: number }, kind: UploadKind): boolean {
  const rule = UPLOAD_RULES[kind];
  if (!rule.accepts.includes(file.type)) return true;
  if (Math.max(dims.width, dims.height) > rule.maxEdge) return true;
  return file.size > rule.targetBytes;
}

/**
 * Picks between the original and the re-encoded file: the re-encode wins when
 * the original is not acceptable to the server, or when it is smaller.
 */
export function chooseUpload<T extends FileLike>(original: T, candidate: T | null, kind: UploadKind): T {
  if (!candidate) return original;
  if (!UPLOAD_RULES[kind].accepts.includes(original.type)) return candidate;
  return candidate.size < original.size ? candidate : original;
}

/** `IMG_2041.HEIC` → `IMG_2041.jpg`. */
export function outputName(name: string): string {
  const base = (name || 'upload').replace(/\.[^./\\]+$/, '');
  return `${base || 'upload'}.jpg`;
}

/**
 * The last check before sending — the same rules the server applies, with a
 * message a tenant can act on. `null` means send it.
 */
export function uploadProblem(file: FileLike, kind: UploadKind): string | null {
  const rule = UPLOAD_RULES[kind];
  if (!rule.accepts.includes(file.type)) {
    if (isImage(file.type)) return "This photo format can't be used here. Choose a JPG or PNG, or take a new photo.";
    return kind === 'photo' ? 'Choose a photo (JPG, PNG or WEBP).' : 'Use a photo of the document, or a PDF.';
  }
  if (file.size > rule.maxBytes) {
    const limit = `${rule.maxBytes / MB}MB`;
    if (file.type === 'application/pdf') return `This PDF is over ${limit}. Upload a photo of the document instead.`;
    return `This photo is still over ${limit} after compressing. Try taking a new photo.`;
  }
  return null;
}
