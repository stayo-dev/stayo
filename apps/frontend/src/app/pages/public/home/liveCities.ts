import type { DiscoverCard } from '@features/discover/api';

/**
 * The cities Stayo actually has listings in, first-seen order.
 *
 * Derived from live listings rather than hard-coded on purpose: the hero's
 * "Now live in …" chip is a promise, and a promise compiled into the bundle
 * goes stale the first time a city's only hostel is suspended.
 */
export function liveCities(cards: DiscoverCard[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const card of cards) {
    const city = card.city?.trim();
    if (!city) continue;
    const key = city.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(city);
  }
  return out;
}

/** Chip copy, or null when there is nothing to promise. */
export function liveCityLabel(cities: string[]): string | null {
  if (cities.length === 0) return null;
  if (cities.length === 1) return `Now live in ${cities[0]}`;
  if (cities.length === 2) return `Now live in ${cities[0]} & ${cities[1]}`;
  return `Now live in ${cities[0]}, ${cities[1]} +${cities.length - 2} more`;
}

/** The city the hero's CTA points at. */
export function primaryCity(cities: string[]): string | null {
  return cities[0] ?? null;
}

export interface DiscoverCityFacet {
  city: string;
  count: number;
}

/**
 * Cities from the search response's facets.
 *
 * Preferred over `liveCities` where available, because facets describe the
 * whole result set while the cards are only the page the homepage fetched —
 * a city whose single hostel sorts onto page two still deserves the chip.
 * Ordered by hostel count so `primaryCity` names the biggest one.
 */
export function citiesFromFacets(facets: DiscoverCityFacet[] | undefined): string[] {
  if (!facets?.length) return [];
  return facets
    .filter((facet) => Boolean(facet.city?.trim()))
    .slice()
    .sort((a, b) => b.count - a.count)
    .map((facet) => facet.city.trim());
}
