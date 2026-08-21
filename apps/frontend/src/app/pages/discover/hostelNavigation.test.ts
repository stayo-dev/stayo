import { describe, expect, it } from 'vitest';
import {
  type HostelNavigation,
  directionsUrl,
  distanceLine,
  hasNavigation,
} from './hostelNavigation';

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
    expect(directionsUrl(nav(), 'Sri Adithya Boys Hostel')).toBe(
      'https://www.google.com/maps/dir/?api=1' +
        '&destination=Sri%20Adithya%20Boys%20Hostel' +
        `&destination_place_id=${PLACE_ID}` +
        '&dir_action=navigate',
    );
  });

  it('encodes a name with characters that would break the query string', () => {
    const url = directionsUrl(nav(), 'Sri Adithya Boys & Girls Hostel #2');
    expect(url).toContain('destination=Sri%20Adithya%20Boys%20%26%20Girls%20Hostel%20%232');
    expect(url).not.toContain('&destination=Sri Adithya');
  });

  it('returns null with no Place ID, so no dead button is drawn', () => {
    expect(directionsUrl(null, 'Sri Adithya')).toBeNull();
    expect(directionsUrl(undefined, 'Sri Adithya')).toBeNull();
    expect(directionsUrl(nav({ placeId: '' }), 'Sri Adithya')).toBeNull();
    expect(directionsUrl(nav({ placeId: '   ' }), 'Sri Adithya')).toBeNull();
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
