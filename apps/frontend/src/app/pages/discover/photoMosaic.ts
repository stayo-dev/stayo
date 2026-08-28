/**
 * The photo-tour mosaic — how a set of photos is laid out.
 *
 * ## What was wrong
 *
 * The section container was `flex flex-col` while its children asked for
 * `sm:inline-block sm:w-[calc(50%-6px)]`. A column flex honours neither: the
 * items stayed one-per-row and merely shrank to half width, so a six-photo
 * section rendered as one full-width hero above a narrow ribbon with the right
 * half of the page blank. It was not a styling preference, it was a layout
 * that could not do what it was written to do.
 *
 * ## The rhythm
 *
 * Tiles are laid on a 6-column grid in a repeating cycle whose every entry
 * **sums to exactly 6**:
 *
 *     [6]  ->  [3,3]  ->  [4,2]  ->  [2,2,2]  ->  [2,4]  ->  repeat
 *
 * That is what makes it look varied without looking accidental. Real
 * randomness would reshuffle on every render — a gallery that rearranges as
 * you scroll back is disorienting — and would sometimes deal three identical
 * rows in a row. This is deterministic: the same photos always land the same
 * way, and the variety is composed rather than rolled.
 *
 * Aspect ratio follows width, because a tile's shape should agree with its
 * size: a full-bleed row is cinematic, a third is square. Uniform ratios are
 * what make a grid read as a spreadsheet.
 *
 * PURE — no React, no DOM.
 */

export const MOSAIC_COLUMNS = 6;

/** Each row's column spans. Every entry sums to `MOSAIC_COLUMNS`. */
const CYCLE: number[][] = [
  [6],
  [3, 3],
  [4, 2],
  [2, 2, 2],
  [2, 4],
];

export interface MosaicTile {
  /** Columns out of 6. */
  span: number;
  /** CSS aspect-ratio for the tile. */
  aspect: string;
}

/** Wide tiles are cinematic, narrow tiles are square — shape follows size. */
function aspectFor(span: number): string {
  if (span >= 6) return '16 / 9';
  if (span >= 4) return '4 / 3';
  if (span === 3) return '4 / 3';
  return '1 / 1';
}

/**
 * Rows of spans for `count` photos.
 *
 * The last row is **stretched to fill** rather than left ragged. A cycle entry
 * of `[2,2,2]` cut short after one photo would otherwise leave two thirds of
 * the row empty — reintroducing the exact white space this replaced.
 */
export function mosaicRows(count: number): number[][] {
  const total = Math.max(0, Math.floor(count));
  if (total === 0) return [];

  const rows: number[][] = [];
  let placed = 0;
  let cycleIndex = 0;

  while (placed < total) {
    const pattern = CYCLE[cycleIndex % CYCLE.length];
    const remaining = total - placed;
    const row = pattern.slice(0, remaining);

    if (row.length < pattern.length) {
      // Short final row: widen its tiles so the row still spans the grid.
      const base = Math.floor(MOSAIC_COLUMNS / row.length);
      const leftover = MOSAIC_COLUMNS - base * row.length;
      for (let i = 0; i < row.length; i += 1) {
        row[i] = base + (i < leftover ? 1 : 0);
      }
    }

    rows.push(row);
    placed += row.length;
    cycleIndex += 1;
  }

  return rows;
}

/** Flat tiles in render order. */
export function mosaicTiles(count: number): MosaicTile[] {
  return mosaicRows(count)
    .flat()
    .map((span) => ({ span, aspect: aspectFor(span) }));
}

/**
 * The mobile layout is a plain 2-up with a full-bleed lead.
 *
 * Six columns of variety on a 390px screen produces tiles too small to read;
 * the rhythm that makes a desktop gallery feel composed makes a phone gallery
 * feel like a contact sheet.
 */
export function mobileSpan(index: number): 1 | 2 {
  return index === 0 ? 2 : 1;
}
