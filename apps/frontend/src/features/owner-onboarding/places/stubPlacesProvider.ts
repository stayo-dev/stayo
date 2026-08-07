import {
  shouldSearch,
  type PlacesProvider,
  type PlaceSuggestion,
  type ResolvedPlace,
} from './placesProvider';

/**
 * Stand-in for Google Places until a key exists.
 *
 * It matches against a small list of real Indian localities so the UI can be
 * built and reviewed honestly, and it reports `isReal: false` so the step can
 * say plainly that suggestions are examples. It is **not** a geocoder: it
 * returns no coordinates, because inventing them would put fake lat/lng on
 * real hostels.
 */

type StubPlace = { id: string; primary: string; secondary: string; city: string };

const PLACES: StubPlace[] = [
  { id: 'stub-yamnampet', primary: 'Yamnampet', secondary: 'Ghatkesar, Hyderabad, Telangana', city: 'Hyderabad' },
  { id: 'stub-gachibowli', primary: 'Gachibowli', secondary: 'Serilingampally, Hyderabad, Telangana', city: 'Hyderabad' },
  { id: 'stub-madhapur', primary: 'Madhapur', secondary: 'Hyderabad, Telangana', city: 'Hyderabad' },
  { id: 'stub-kukatpally', primary: 'Kukatpally', secondary: 'Hyderabad, Telangana', city: 'Hyderabad' },
  { id: 'stub-ameerpet', primary: 'Ameerpet', secondary: 'Hyderabad, Telangana', city: 'Hyderabad' },
  { id: 'stub-koramangala', primary: 'Koramangala', secondary: 'Bengaluru, Karnataka', city: 'Bengaluru' },
  { id: 'stub-btm', primary: 'BTM Layout', secondary: 'Bengaluru, Karnataka', city: 'Bengaluru' },
  { id: 'stub-whitefield', primary: 'Whitefield', secondary: 'Bengaluru, Karnataka', city: 'Bengaluru' },
  { id: 'stub-kothrud', primary: 'Kothrud', secondary: 'Pune, Maharashtra', city: 'Pune' },
  { id: 'stub-viman-nagar', primary: 'Viman Nagar', secondary: 'Pune, Maharashtra', city: 'Pune' },
  { id: 'stub-anna-nagar', primary: 'Anna Nagar', secondary: 'Chennai, Tamil Nadu', city: 'Chennai' },
  { id: 'stub-velachery', primary: 'Velachery', secondary: 'Chennai, Tamil Nadu', city: 'Chennai' },
];

export class StubPlacesProvider implements PlacesProvider {
  readonly name = 'examples';
  readonly isReal = false;

  async search(query: string): Promise<PlaceSuggestion[]> {
    if (!shouldSearch(query)) return [];
    const q = query.trim().toLowerCase();

    return PLACES.filter(
      (p) => p.primary.toLowerCase().includes(q) || p.secondary.toLowerCase().includes(q),
    )
      .slice(0, 5)
      .map(({ id, primary, secondary }) => ({ id, primary, secondary }));
  }

  async resolve(suggestion: PlaceSuggestion): Promise<ResolvedPlace> {
    const match = PLACES.find((p) => p.id === suggestion.id);
    return {
      id: suggestion.id,
      address: suggestion.primary,
      city: match?.city ?? '',
      // No coordinates by design — see the class comment.
      lat: null,
      lng: null,
    };
  }
}

export const stubPlacesProvider = new StubPlacesProvider();
