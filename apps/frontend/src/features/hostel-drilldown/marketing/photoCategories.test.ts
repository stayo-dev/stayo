import { describe, expect, it } from 'vitest';

import { groupTourSections, moveSection, orderPhotoSections } from './photoCategories';

const CANONICAL = ['rooms', 'bathrooms', 'mess', 'common', 'study', 'outside', 'other'];

const photo = (category?: string) => ({ url: `${category ?? 'none'}.jpg`, category });

describe('orderPhotoSections', () => {
  it('is the standard order when nobody has arranged anything', () => {
    expect(orderPhotoSections(undefined)).toEqual(CANONICAL);
    expect(orderPhotoSections([])).toEqual(CANONICAL);
  });

  it('completes a partial order rather than losing a section', () => {
    // What an owner who moved one section leaves behind. A key missing from
    // this list would drop a whole section of photos from the listing.
    const order = orderPhotoSections(['mess']);
    expect(order[0]).toBe('mess');
    expect(new Set(order).size).toBe(CANONICAL.length);
  });

  it('drops a key that is not a section, and a repeat', () => {
    expect(orderPhotoSections(['terrace'])).toEqual(CANONICAL);
    expect(orderPhotoSections(['mess', 'mess'])[0]).toBe('mess');
    expect(new Set(orderPhotoSections(['mess', 'mess'])).size).toBe(CANONICAL.length);
  });
});

describe('groupTourSections', () => {
  it('groups photos in the owner arranged order', () => {
    const sections = groupTourSections([photo('rooms'), photo('mess')], ['mess', 'rooms']);
    expect(sections.map((section) => section.key)).toEqual(['mess', 'rooms']);
  });

  it('never shows an empty section', () => {
    expect(groupTourSections([photo('rooms')], null).map((section) => section.key)).toEqual(['rooms']);
    expect(groupTourSections([], null)).toEqual([]);
  });

  it('puts an uncategorised photo in More photos rather than dropping it', () => {
    // Everything uploaded before categories existed has no category.
    expect(groupTourSections([photo(undefined)], null).map((section) => section.key)).toEqual(['other']);
  });

  it('labels each section the way the owner picked it', () => {
    expect(groupTourSections([photo('mess')], null)[0].label).toBe('Mess & kitchen');
  });
});

describe('moveSection', () => {
  const visible = ['rooms', 'mess', 'outside'];

  it('swaps a section with the next one that is actually shown', () => {
    // `bathrooms`, `common` and `study` sit between these in the standard
    // order with no photos in them. A move that swapped with one of those
    // would look like a button that does nothing.
    const order = moveSection(undefined, 'rooms', 1, visible);
    expect(order.filter((key) => visible.includes(key))).toEqual(['mess', 'rooms', 'outside']);
  });

  it('moves a section earlier', () => {
    const order = moveSection(undefined, 'outside', -1, visible);
    expect(order.filter((key) => visible.includes(key))).toEqual(['rooms', 'outside', 'mess']);
  });

  it('leaves the order alone at either end', () => {
    expect(moveSection(undefined, 'rooms', -1, visible)).toEqual(CANONICAL);
    expect(moveSection(undefined, 'outside', 1, visible)).toEqual(CANONICAL);
  });

  it('keeps an empty section in its own slot', () => {
    // A section with no photos is hidden, not reordered — it keeps its place
    // for when the owner adds a photo to it.
    const order = moveSection(undefined, 'rooms', 1, visible);
    expect(order.indexOf('bathrooms')).toBe(CANONICAL.indexOf('bathrooms'));
  });

  it('ignores a move of a section that is not shown', () => {
    expect(moveSection(undefined, 'study', 1, visible)).toEqual(CANONICAL);
  });

  it('returns a complete order whatever it was given', () => {
    expect(new Set(moveSection(['mess'], 'mess', 1, visible)).size).toBe(CANONICAL.length);
  });
});
