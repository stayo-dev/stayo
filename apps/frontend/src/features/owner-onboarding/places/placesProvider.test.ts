import { describe, it, expect } from 'vitest';
import { shouldSearch, MIN_QUERY_LENGTH, SEARCH_DEBOUNCE_MS } from './placesProvider';
import { stubPlacesProvider } from './stubPlacesProvider';

describe('shouldSearch', () => {
  // Under Google this is billed per request, so a one-character query must
  // never reach the provider.
  it('does not search below the minimum query length', () => {
    expect(shouldSearch('')).toBe(false);
    expect(shouldSearch('a')).toBe(false);
    expect(shouldSearch('ya')).toBe(false);
  });

  it('searches once the query is long enough', () => {
    expect(shouldSearch('yam')).toBe(true);
  });

  it('ignores surrounding whitespace when measuring', () => {
    expect(shouldSearch('  a  ')).toBe(false);
    expect(shouldSearch('  yam  ')).toBe(true);
  });

  it('keeps the debounce long enough to collapse a typed word into one request', () => {
    expect(SEARCH_DEBOUNCE_MS).toBeGreaterThanOrEqual(200);
    expect(MIN_QUERY_LENGTH).toBeGreaterThanOrEqual(3);
  });
});

describe('stub provider', () => {
  // The step tells the owner these are examples. If this ever reported true,
  // that message would disappear and fake data would look authoritative.
  it('declares itself as not real, so the UI can say so', () => {
    expect(stubPlacesProvider.isReal).toBe(false);
  });

  it('returns nothing for a query below the threshold', async () => {
    expect(await stubPlacesProvider.search('ya')).toEqual([]);
  });

  it('matches on the locality name', async () => {
    const results = await stubPlacesProvider.search('yamnam');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].primary).toBe('Yamnampet');
  });

  it('matches on the city in the secondary line', async () => {
    const results = await stubPlacesProvider.search('bengaluru');
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => /Bengaluru/.test(r.secondary))).toBe(true);
  });

  it('is case-insensitive', async () => {
    expect((await stubPlacesProvider.search('KORAMANGALA')).length).toBeGreaterThan(0);
  });

  it('caps the list so the dropdown stays scannable', async () => {
    expect((await stubPlacesProvider.search('a')).length).toBeLessThanOrEqual(5);
    expect((await stubPlacesProvider.search('an')).length).toBeLessThanOrEqual(5);
  });

  it('returns an empty list rather than throwing on no match', async () => {
    expect(await stubPlacesProvider.search('zzzznowhere')).toEqual([]);
  });

  it('resolves a suggestion to an address and city', async () => {
    const [first] = await stubPlacesProvider.search('gachi');
    const resolved = await stubPlacesProvider.resolve(first);
    expect(resolved.address).toBe('Gachibowli');
    expect(resolved.city).toBe('Hyderabad');
  });

  // Inventing coordinates would put fake lat/lng on real hostels, which is
  // worse than having none.
  it('never invents coordinates', async () => {
    const [first] = await stubPlacesProvider.search('madhapur');
    const resolved = await stubPlacesProvider.resolve(first);
    expect(resolved.lat).toBeNull();
    expect(resolved.lng).toBeNull();
  });
});
