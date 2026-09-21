/**
 * Getting a generated file from the server into the owner's hands.
 *
 * The blob → anchor → click → revoke dance was copy-pasted at six call sites
 * and the `Content-Disposition` regex at three, each slightly different. It is
 * written once here.
 *
 * Imports nothing: `src/shared` must stay a leaf (enforced by
 * `scripts/check-architecture.mjs`).
 */

/**
 * The filename the server chose, or a fallback.
 *
 * Pure, and deliberately separate from the download itself, because the
 * frontend test suite is node-only with no DOM — this is the half that can
 * actually be verified.
 */
export function filenameFromContentDisposition(
  header: string | undefined | null,
  fallback: string,
): string {
  const value = String(header ?? '');
  const match = value.match(/filename="([^"]+)"/) ?? value.match(/filename=([^;]+)/);
  const name = match?.[1]?.trim();
  return name || fallback;
}

/** The blob → anchor → click → revoke dance, written once instead of six times. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = window.document.createElement('a');
  link.href = url;
  link.download = filename;
  window.document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/**
 * Share the real file where the OS sheet exists, download where it does not.
 *
 * A `wa.me` link cannot carry a file, so falling back to a download is the only
 * honest option — never open WhatsApp with nothing attached. Returns which one
 * happened so the caller can word its confirmation accordingly.
 */
export async function shareOrDownload(
  blob: Blob,
  filename: string,
  title: string,
): Promise<'shared' | 'downloaded'> {
  const file = new File([blob], filename, { type: blob.type });
  if (typeof navigator !== 'undefined' && navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file], title });
    return 'shared';
  }
  downloadBlob(blob, filename);
  return 'downloaded';
}

/** Whether the OS share sheet is available at all — decides if a Share button renders. */
export function canShareFiles(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.share === 'function';
}
