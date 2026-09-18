import { describe, expect, it } from 'vitest';
import type { DiscoverCard } from '@features/discover/api';
import { citiesFromFacets, liveCities, liveCityLabel, primaryCity } from './liveCities';

function card(city: string | null): DiscoverCard {
  return {
    id: 'h1',
    slug: 's',
    name: 'N',
    city,
    address: 'A',
    latitude: null,
    longitude: null,
    hostel_type: 'BOYS',
    food_included: false,
    verified: true,
    photos: [],
    listed_at: '2026-01-01T00:00:00.000Z',
    vacant_beds: 1,
    starting_price: null,
    sharing: [],
  } as DiscoverCard;
}

describe('liveCities', () => {
  it('dedupes case-insensitively and keeps first-seen spelling and order', () => {
    expect(liveCities([card('Hyderabad'), card('hyderabad'), card('Pune')])).toEqual(['Hyderabad', 'Pune']);
  });

  it('ignores null and blank cities', () => {
    expect(liveCities([card(null), card('   '), card('Pune')])).toEqual(['Pune']);
  });

  it('returns an empty list for no cards', () => {
    expect(liveCities([])).toEqual([]);
  });
});

describe('liveCityLabel', () => {
  it('is null with no cities, so the chip can be hidden', () => {
    expect(liveCityLabel([])).toBeNull();
  });

  it('names one city', () => {
    expect(liveCityLabel(['Hyderabad'])).toBe('Now live in Hyderabad');
  });

  it('joins two with an ampersand', () => {
    expect(liveCityLabel(['Hyderabad', 'Pune'])).toBe('Now live in Hyderabad & Pune');
  });

  it('counts the remainder past two', () => {
    expect(liveCityLabel(['Hyderabad', 'Pune', 'Mumbai', 'Delhi'])).toBe('Now live in Hyderabad, Pune +2 more');
  });
});

describe('primaryCity', () => {
  it('is the first city, or null', () => {
    expect(primaryCity(['Pune', 'Delhi'])).toBe('Pune');
    expect(primaryCity([])).toBeNull();
  });
});

describe('citiesFromFacets', () => {
  it('is empty when the search returned no facets', () => {
    expect(citiesFromFacets(undefined)).toEqual([]);
    expect(citiesFromFacets([])).toEqual([]);
  });

  it('orders by how many hostels each city has, biggest first', () => {
    expect(
      citiesFromFacets([
        { city: 'Pune', count: 1 },
        { city: 'Hyderabad', count: 4 },
      ]),
    ).toEqual(['Hyderabad', 'Pune']);
  });

  it('drops blank city facets', () => {
    expect(citiesFromFacets([{ city: '  ', count: 9 }, { city: 'Pune', count: 1 }])).toEqual(['Pune']);
  });
});
