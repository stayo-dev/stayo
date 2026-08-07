/**
 * Address lookup for the location step, behind a provider interface.
 *
 * There is no Google Maps API key yet, and Places Autocomplete bills per
 * keystroke — so the full UI ships now against a stub, and swapping in Google
 * later is a config change rather than a rewrite. That is the whole reason
 * this interface exists; without it the step would have to be rebuilt when the
 * key arrives.
 *
 * Pure and I/O-free at this layer: implementations do the fetching, this file
 * only defines the contract and the query rules, so both are testable in the
 * node-only environment.
 */

export type PlaceSuggestion = {
  /** Stable id from the provider — `place_id` under Google. */
  id: string;
  /** Bold line: "Yamnampet". */
  primary: string;
  /** Muted line: "Ghatkesar, Hyderabad, Telangana". */
  secondary: string;
};

export type ResolvedPlace = {
  id: string;
  address: string;
  city: string;
  /** Null until a real geocoding provider is wired up. */
  lat: number | null;
  lng: number | null;
};

export interface PlacesProvider {
  /** Provider name, surfaced in the UI so a stub is never mistaken for real data. */
  readonly name: string;
  /** True once results are real places rather than placeholders. */
  readonly isReal: boolean;
  search(query: string, signal?: AbortSignal): Promise<PlaceSuggestion[]>;
  resolve(suggestion: PlaceSuggestion): Promise<ResolvedPlace>;
}

/** Below this, autocomplete is noise — and under Google it would be billed noise. */
export const MIN_QUERY_LENGTH = 3;

/** Debounce before querying, so a typed word is one request rather than eight. */
export const SEARCH_DEBOUNCE_MS = 300;

export function shouldSearch(query: string): boolean {
  return String(query ?? '').trim().length >= MIN_QUERY_LENGTH;
}
