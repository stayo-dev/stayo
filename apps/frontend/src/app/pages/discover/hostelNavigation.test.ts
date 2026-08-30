import { describe, expect, it } from 'vitest';
import { type HostelNavigation, directionsUrl, distanceLine, hasNavigation, hasCoordinates, mapEmbedUrl, whereYoullBe, isGoogleMapsEmbedUrl } from './hostelNavigation';

const PLACE_ID = 'ChIJN1t_tDeuEmsRUsoyG83frY4';

function nav(overrides: Partial<HostelNavigation> = {}): HostelNavigation {
  return {
    placeId: PLACE_ID,
    landmark: 'Opposite SNIST Gate 2',
    entrancePhoto: 'https://ik.imagekit.io/stayo/entrance.jpg',
    distanceFromReference: '400m',
    referenceName: 'SNIST',
    ...overrides,
  };
}

describe('directionsUrl', () => {
  it('builds the documented one-tap navigate URL', () => {
    expect(directionsUrl(nav(), 'Sunrise Residency')).toBe(
      'https://www.google.com/maps/dir/?api=1' +
        '&destination=Sunrise%20Residency' +
        `&destination_place_id=${PLACE_ID}` +
        '&dir_action=navigate',
    );
  });

  it('encodes a name with characters that would break the query string', () => {
    const url = directionsUrl(nav(), 'Sunrise Residency Boys & Girls Hostel #2');
    expect(url).toContain('destination=Sunrise%20Residency%20Boys%20%26%20Girls%20Hostel%20%232');
    expect(url).not.toContain('&destination=Sunrise Residency');
  });

  it('returns null with no Place ID, so no dead button is drawn', () => {
    expect(directionsUrl(null, 'Sunrise Residency')).toBeNull();
    expect(directionsUrl(undefined, 'Sunrise Residency')).toBeNull();
    expect(directionsUrl(nav({ placeId: '' }), 'Sunrise Residency')).toBeNull();
    expect(directionsUrl(nav({ placeId: '   ' }), 'Sunrise Residency')).toBeNull();
  });

  it('never emits a bare hostel name as the destination when the name is blank', () => {
    expect(directionsUrl(nav(), '   ')).toContain('&destination=Hostel&');
  });

  it('carries the Place ID verbatim — it is the thing that resolves the pin', () => {
    expect(directionsUrl(nav(), 'X')).toContain(`destination_place_id=${PLACE_ID}`);
  });
});

describe('distanceLine', () => {
  it('reads as a sentence a person would say', () => {
    expect(distanceLine(nav())).toBe('400m from SNIST');
    expect(distanceLine(nav({ distanceFromReference: '5 min walk' }))).toBe('5 min walk from SNIST');
  });

  it('follows the stored reference rather than hardcoding SNIST', () => {
    expect(distanceLine(nav({ referenceName: 'VNRVJIET' }))).toBe('400m from VNRVJIET');
  });

  it('says nothing when the distance was never entered', () => {
    expect(distanceLine(nav({ distanceFromReference: null }))).toBeNull();
    expect(distanceLine(nav({ distanceFromReference: '  ' }))).toBeNull();
    expect(distanceLine(null)).toBeNull();
  });
});

describe('hasNavigation', () => {
  it('turns on the block for a Place ID alone', () => {
    expect(hasNavigation({ placeId: PLACE_ID } as HostelNavigation)).toBe(true);
  });

  it('is false for a hostel nobody has located', () => {
    expect(hasNavigation(null)).toBe(false);
    expect(hasNavigation(nav({ placeId: '' }))).toBe(false);
  });
});

describe('the pin', () => {
  const at = (lat: number | null | undefined, lng: number | null | undefined) =>
    ({ placeId: 'ChIJx', landmark: null, entrancePhoto: null, distanceFromReference: null, referenceName: 'SNIST', lat, lng } as any);

  it('accepts a real coordinate', () => {
    // Sunrise Residency, Yamnampet.
    expect(hasCoordinates(at(17.4542678, 78.6628497))).toBe(true);
  });

  it('treats a missing coordinate as no pin', () => {
    expect(hasCoordinates(at(null, null))).toBe(false);
    expect(hasCoordinates(at(17.45, undefined))).toBe(false);
    expect(hasCoordinates(null)).toBe(false);
  });

  // 0,0 is a real place in the Gulf of Guinea and the commonest value an empty
  // numeric field produces. Drawing a confident pin there is worse than none.
  it('rejects 0,0 rather than mapping the Atlantic', () => {
    expect(hasCoordinates(at(0, 0))).toBe(false);
  });

  it('rejects out-of-range values', () => {
    expect(hasCoordinates(at(91, 78))).toBe(false);
    expect(hasCoordinates(at(17, 181))).toBe(false);
    expect(hasCoordinates(at(Number.NaN, 78))).toBe(false);
  });
});

describe('the embedded map', () => {
  const nav = {
    placeId: 'ChIJx',
    landmark: null,
    entrancePhoto: null,
    distanceFromReference: null,
    referenceName: 'SNIST',
    lat: 17.4542678,
    lng: 78.6628497,
  } as any;

  // The whole point: this project has no Google Maps key, and adding one is a
  // billing decision rather than a code one. `output=embed` needs none.
  it('builds a keyless Google embed for the pin', () => {
    const url = mapEmbedUrl(nav)!;
    expect(url).toContain('maps.google.com/maps');
    expect(url).toContain('output=embed');
    expect(url).toContain('q=17.4542678,78.6628497');
    expect(url).not.toMatch(/[?&]key=/);
  });

  it('zooms to street level rather than to the city', () => {
    // Wide enough to show the road and the campus gate, tight enough that the
    // pin means a building.
    expect(mapEmbedUrl(nav)).toContain('z=16');
  });

  it('returns nothing without a usable pin, so the caller can fall back', () => {
    expect(mapEmbedUrl({ ...nav, lat: null, lng: null })).toBeNull();
    expect(mapEmbedUrl({ ...nav, lat: 0, lng: 0 })).toBeNull();
  });
});

describe('the pasted embed URL — an allowlist, because it goes in an iframe', () => {
  const GOOD = 'https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3806';

  it('accepts a real Share-to-embed URL', () => {
    expect(isGoogleMapsEmbedUrl(GOOD)).toBe(true);
    expect(isGoogleMapsEmbedUrl('https://maps.google.com/maps/embed?pb=!1m18')).toBe(true);
  });

  // The whole trick: endsWith('google.com') accepts this.
  it('refuses a lookalike host', () => {
    expect(isGoogleMapsEmbedUrl('https://www.google.com.evil.tld/maps/embed?pb=x')).toBe(false);
    expect(isGoogleMapsEmbedUrl('https://evil.tld/maps/embed?pb=x')).toBe(false);
    expect(isGoogleMapsEmbedUrl('https://notgoogle.com/maps/embed')).toBe(false);
  });

  it('refuses a non-embed path on the right host', () => {
    // Embedding a full Google Maps page, or anything else on the domain, is not
    // what this field is for.
    expect(isGoogleMapsEmbedUrl('https://www.google.com/maps/place/Somewhere')).toBe(false);
    expect(isGoogleMapsEmbedUrl('https://www.google.com/')).toBe(false);
    expect(isGoogleMapsEmbedUrl('https://www.google.com/maps/embedding')).toBe(false);
  });

  it('refuses non-https and non-URL input', () => {
    expect(isGoogleMapsEmbedUrl('http://www.google.com/maps/embed?pb=x')).toBe(false);
    expect(isGoogleMapsEmbedUrl('javascript:alert(1)')).toBe(false);
    expect(isGoogleMapsEmbedUrl('data:text/html,<script>')).toBe(false);
    expect(isGoogleMapsEmbedUrl('')).toBe(false);
    expect(isGoogleMapsEmbedUrl(null)).toBe(false);
  });
});

describe('which map wins', () => {
  const base = {
    placeId: 'ChIJx',
    landmark: null,
    entrancePhoto: null,
    distanceFromReference: null,
    referenceName: 'SNIST',
    lat: 17.4542678,
    lng: 78.6628497,
  } as any;
  const GOOD = 'https://www.google.com/maps/embed?pb=!1m18!1m12';

  it('prefers a pasted embed, because only that renders the place card', () => {
    expect(mapEmbedUrl({ ...base, embedUrl: GOOD })).toBe(GOOD);
  });

  // A refused URL must not take the listing down with it.
  it('falls back to the derived coordinate map when the pasted URL is not trusted', () => {
    const url = mapEmbedUrl({ ...base, embedUrl: 'https://evil.tld/maps/embed' })!;
    expect(url).toContain('output=embed');
    expect(url).toContain('q=17.4542678,78.6628497');
  });

  it('uses coordinates when nothing was pasted', () => {
    expect(mapEmbedUrl({ ...base, embedUrl: null })).toContain('output=embed');
  });

  it('shows no map when there is neither', () => {
    expect(mapEmbedUrl({ ...base, lat: null, lng: null, embedUrl: null })).toBeNull();
  });
});

describe('where you will be', () => {
  it('reads as a place a person would name', () => {
    expect(whereYoullBe({ area: 'Yamnampet', city: 'Hyderabad', state: 'Telangana' })).toBe(
      'Yamnampet, Hyderabad, Telangana',
    );
  });

  it('skips blanks rather than leaving stray commas', () => {
    expect(whereYoullBe({ area: null, city: 'Hyderabad', state: '  ' })).toBe('Hyderabad');
  });

  it('does not repeat a value that appears twice', () => {
    expect(whereYoullBe({ area: 'Hyderabad', city: 'Hyderabad', state: 'Telangana' })).toBe('Hyderabad, Telangana');
  });
});
