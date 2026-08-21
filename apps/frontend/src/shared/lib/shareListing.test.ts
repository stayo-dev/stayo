import { describe, expect, it } from 'vitest';
import {
  buildShareText,
  buildShareUrl,
  shareMethodFor,
  shouldFallbackAfterShareError,
} from './shareListing';

describe('buildShareUrl', () => {
  it('shares the preview path, not the SPA listing path', () => {
    // /h/ is server-rendered with the hostel's photo; /discover/h/ is the SPA,
    // which every crawler sees as the generic Stayo card.
    expect(buildShareUrl('starlink-79ba709b', 'https://yourstayo.com'))
      .toBe('https://yourstayo.com/h/starlink-79ba709b');
  });

  it('tolerates a trailing slash on the origin', () => {
    expect(buildShareUrl('abc', 'https://yourstayo.com/')).toBe('https://yourstayo.com/h/abc');
  });

  it('works on a preview deploy or localhost', () => {
    expect(buildShareUrl('abc', 'http://localhost:5173')).toBe('http://localhost:5173/h/abc');
  });
});

describe('buildShareText', () => {
  it('reads as something a person would type', () => {
    expect(buildShareText({ name: 'Starlink', slug: 'x', city: 'Hyderabad' }))
      .toBe('Starlink, Hyderabad — on Stayo');
  });

  it('drops the comma when there is no city', () => {
    expect(buildShareText({ name: 'Starlink', slug: 'x', city: null })).toBe('Starlink — on Stayo');
  });
});

describe('shareMethodFor', () => {
  it('uses the OS sheet where there is one', () => {
    expect(shareMethodFor(true)).toBe('native');
  });

  it('copies the link on desktop', () => {
    expect(shareMethodFor(false)).toBe('copy');
  });
});

describe('shouldFallbackAfterShareError', () => {
  it('stays silent when the person cancelled the sheet', () => {
    expect(shouldFallbackAfterShareError({ name: 'AbortError' })).toBe(false);
  });

  it('falls back to the clipboard on a real failure', () => {
    expect(shouldFallbackAfterShareError({ name: 'NotAllowedError' })).toBe(true);
    expect(shouldFallbackAfterShareError(new Error('boom'))).toBe(true);
    expect(shouldFallbackAfterShareError(null)).toBe(true);
  });
});
