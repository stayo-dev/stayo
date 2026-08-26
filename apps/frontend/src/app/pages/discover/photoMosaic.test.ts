import { describe, expect, it } from 'vitest';
import { MOSAIC_COLUMNS, mobileSpan, mosaicRows, mosaicTiles } from './photoMosaic';

const sums = (rows: number[][]) => rows.map((row) => row.reduce((a, b) => a + b, 0));

describe('the mosaic never leaves a ragged row', () => {
  it('fills every row exactly, for every count up to 40', () => {
    // This is the whole point: the old layout left half the page blank.
    for (let count = 1; count <= 40; count += 1) {
      expect(sums(mosaicRows(count)), `count=${count}`).toEqual(
        sums(mosaicRows(count)).map(() => MOSAIC_COLUMNS),
      );
    }
  });

  it('places exactly as many tiles as there are photos', () => {
    for (let count = 1; count <= 40; count += 1) {
      expect(mosaicRows(count).flat().length, `count=${count}`).toBe(count);
    }
  });

  it('stretches a short final row instead of leaving a hole', () => {
    // Cycle row 4 is [2,2,2]; with one photo left it must become [6].
    expect(mosaicRows(1)).toEqual([[6]]);
    // Two photos: a hero, then the second alone — stretched to full width
    // rather than left as a lonely half with a hole beside it.
    expect(mosaicRows(2)).toEqual([[6], [6]]);
    expect(mosaicRows(3)).toEqual([[6], [3, 3]]);
    const four = mosaicRows(4);
    expect(four[four.length - 1].reduce((a, b) => a + b, 0)).toBe(MOSAIC_COLUMNS);
  });

  it('distributes the remainder rather than dropping it', () => {
    // 6 / 4 tiles = 1.5 each, so two tiles get 2 and two get 1.
    const rows = mosaicRows(100);
    for (const row of rows) {
      expect(row.every((span) => span >= 1)).toBe(true);
    }
  });
});

describe('the rhythm', () => {
  it('opens full-bleed', () => {
    expect(mosaicTiles(9)[0].span).toBe(6);
  });

  it('varies, rather than repeating one row shape', () => {
    const rows = mosaicRows(20).slice(0, 5).map((r) => r.length);
    expect(new Set(rows).size).toBeGreaterThan(1);
  });

  it('is deterministic — the same photos always land the same way', () => {
    // Real randomness would reshuffle on re-render, which is disorienting.
    expect(mosaicTiles(13)).toEqual(mosaicTiles(13));
  });

  it('gives a tile a shape that agrees with its width', () => {
    const tiles = mosaicTiles(12);
    expect(tiles.find((t) => t.span === 6)?.aspect).toBe('16 / 9');
    expect(tiles.find((t) => t.span === 2)?.aspect).toBe('1 / 1');
  });
});

describe('edges', () => {
  it('has nothing to lay out for nothing', () => {
    expect(mosaicRows(0)).toEqual([]);
    expect(mosaicTiles(0)).toEqual([]);
    expect(mosaicRows(-3)).toEqual([]);
  });

  it('ignores a fractional count rather than producing a fractional tile', () => {
    expect(mosaicRows(3.7).flat().length).toBe(3);
  });
});

describe('mobile', () => {
  it('leads full-bleed then goes two-up', () => {
    // Six columns of variety on a 390px screen is a contact sheet, not a gallery.
    expect(mobileSpan(0)).toBe(2);
    expect(mobileSpan(1)).toBe(1);
    expect(mobileSpan(7)).toBe(1);
  });
});
