import { describe, expect, it } from 'vitest';
import { coordinatesHint, parseCoordinates, embedUrlHint, extractEmbedSrc } from './parseCoordinates';

describe('what an admin pastes', () => {
  // The literal string copied out of a search result for Sri Adithya Boys Hostel.
  it('accepts "lat, lng" straight from a search result', () => {
    expect(parseCoordinates('17.4542678, 78.6628497')).toEqual({ lat: 17.4542678, lng: 78.6628497 });
  });

  it('accepts it without the space', () => {
    expect(parseCoordinates('17.4542678,78.6628497')).toEqual({ lat: 17.4542678, lng: 78.6628497 });
  });

  it('tolerates decorations a copy-paste picks up', () => {
    expect(parseCoordinates('(17.4542678, 78.6628497)')).toEqual({ lat: 17.4542678, lng: 78.6628497 });
    expect(parseCoordinates('17.4542678°, 78.6628497°')).toEqual({ lat: 17.4542678, lng: 78.6628497 });
  });

  it('handles negative coordinates', () => {
    expect(parseCoordinates('-33.8688, 151.2093')).toEqual({ lat: -33.8688, lng: 151.2093 });
  });
});

describe('what it refuses, and why', () => {
  // A wrong pin is worse than no pin: no pin shows the landmark block and the
  // person asks; a wrong pin sends them confidently to the wrong street.
  it('refuses anything that is not clearly a pair', () => {
    expect(parseCoordinates('')).toEqual({ lat: null, lng: null });
    expect(parseCoordinates('17.4542678')).toEqual({ lat: null, lng: null });
    expect(parseCoordinates('17.45, 78.66, 12')).toEqual({ lat: null, lng: null });
    expect(parseCoordinates('Yamnampet, Hyderabad')).toEqual({ lat: null, lng: null });
  });

  // Rather than guessing at sign conventions nobody typed.
  it('refuses hemisphere letters instead of interpreting them', () => {
    expect(parseCoordinates('17.4542678 N, 78.6628497 E')).toEqual({ lat: null, lng: null });
  });

  it('refuses out-of-range values', () => {
    expect(parseCoordinates('91, 78')).toEqual({ lat: null, lng: null });
    expect(parseCoordinates('17, 181')).toEqual({ lat: null, lng: null });
  });

  it('treats 0,0 as not entered', () => {
    expect(parseCoordinates('0, 0')).toEqual({ lat: null, lng: null });
  });
});

describe('the hint shown to the admin', () => {
  it('says nothing for an empty field', () => {
    expect(coordinatesHint('')).toBeNull();
  });

  it('confirms a good pin', () => {
    expect(coordinatesHint('17.4542678, 78.6628497')).toBe('Pin set to 17.4542678, 78.6628497');
  });

  it('explains a bad one rather than failing silently on save', () => {
    expect(coordinatesHint('Yamnampet')).toContain('latitude, longitude');
  });
});

describe('what Google actually puts on the clipboard', () => {
  // Google Maps' "Embed a map" dialog has one button and it copies the whole
  // tag. Telling an admin to "paste the src" is an instruction nobody can
  // follow without hand-editing HTML.
  const IFRAME =
    '<iframe src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3806.11!2sSri%20Adithya%20Boys%20Hostel" width="600" height="450" style="border:0;" allowfullscreen="" loading="lazy" referrerpolicy="strict-origin-when-cross-origin"></iframe>';

  it('pulls the src out of a pasted iframe tag', () => {
    expect(extractEmbedSrc(IFRAME)).toBe(
      'https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3806.11!2sSri%20Adithya%20Boys%20Hostel',
    );
  });

  it('leaves a bare URL alone, so both pastes work', () => {
    const url = 'https://www.google.com/maps/embed?pb=!1m18';
    expect(extractEmbedSrc(url)).toBe(url);
  });

  it('handles single quotes', () => {
    expect(extractEmbedSrc("<iframe src='https://www.google.com/maps/embed?pb=x'></iframe>")).toBe(
      'https://www.google.com/maps/embed?pb=x',
    );
  });

  it('returns empty for empty input', () => {
    expect(extractEmbedSrc('')).toBe('');
  });

  // Extraction decides *what* to validate, never whether it is safe — the
  // allowlist still runs on the result.
  it('extracts a hostile src too, leaving the allowlist to refuse it', () => {
    expect(extractEmbedSrc('<iframe src="https://evil.tld/maps/embed"></iframe>')).toBe('https://evil.tld/maps/embed');
    expect(embedUrlHint('<iframe src="https://evil.tld/maps/embed"></iframe>')).toContain('not a Google');
  });

  it('accepts the real paste end to end', () => {
    expect(embedUrlHint(IFRAME)).toContain('Looks good');
  });
});
