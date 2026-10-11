/**
 * Sizing for a PDF page drawn to a canvas: fill the container's width, and
 * back it with enough device pixels that text stays sharp on a phone.
 *
 * `cssScale` turns PDF points into CSS pixels; `pixelScale` is what the page
 * is actually rendered at. The device pixel ratio is capped because a 3x
 * canvas of a long agreement is a lot of memory for no visible gain.
 */
export const MAX_PIXEL_RATIO = 2;

export function pdfPageScale(
  containerWidth: number,
  pageWidthPoints: number,
  devicePixelRatio = 1,
): { cssScale: number; pixelScale: number } {
  if (!(containerWidth > 0) || !(pageWidthPoints > 0)) return { cssScale: 1, pixelScale: 1 };
  const cssScale = containerWidth / pageWidthPoints;
  const ratio = Math.min(Math.max(devicePixelRatio || 1, 1), MAX_PIXEL_RATIO);
  return { cssScale, pixelScale: cssScale * ratio };
}
