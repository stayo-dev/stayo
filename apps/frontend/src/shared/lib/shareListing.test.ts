import { describe, expect, it } from 'vitest';
import { buildShareText, buildShareUrl, shareMethodFor, shouldFallbackAfterShareError, buildShareLinks, buildShareSummary } from './shareListing';

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

describe('the share sheet targets', () => {
  const hostel = { name: 'Sunrise Residency', slug: 'starlink-79ba709b', city: 'Hyderabad' };
  const url = 'https://yourstayo.com/h/starlink-79ba709b';
  const links = buildShareLinks(hostel, url);

  it('offers WhatsApp first, because for this audience that is messaging', () => {
    expect(links[0].channel).toBe('whatsapp');
  });

  it('needs no SDK, app id or key — every target is a plain URL', () => {
    for (const link of links) {
      expect(link.href).not.toMatch(/app_?id|client_?id|api[_-]?key/i);
    }
  });

  it('carries the link inside the message for chat apps', () => {
    const whatsapp = links.find((l) => l.channel === 'whatsapp')!;
    expect(decodeURIComponent(whatsapp.href)).toContain(url);
    expect(decodeURIComponent(whatsapp.href)).toContain('Sunrise Residency, Hyderabad — on Stayo');
  });

  it('encodes the url, so a slug with punctuation cannot break the target', () => {
    const [fb] = buildShareLinks(hostel, 'https://yourstayo.com/h/a b&c').filter((l) => l.channel === 'facebook');
    expect(fb.href).toContain(encodeURIComponent('https://yourstayo.com/h/a b&c'));
    expect(fb.href).not.toContain('&c=');
  });

  it('keeps mailto and sms in the same tab', () => {
    // Opening `mailto:` in a new tab leaves a blank window behind on desktop.
    expect(links.find((l) => l.channel === 'email')!.external).toBe(false);
    expect(links.find((l) => l.channel === 'sms')!.external).toBe(false);
    expect(links.find((l) => l.channel === 'facebook')!.external).toBe(true);
  });

  it('uses the sms form both iOS and Android accept', () => {
    expect(links.find((l) => l.channel === 'sms')!.href.startsWith('sms:?&body=')).toBe(true);
  });
});

describe('the sheet summary line', () => {
  it('names the kind of hostel and where it is', () => {
    expect(buildShareSummary({ city: 'Hyderabad', hostelType: 'BOYS', startingPrice: 8000 })).toBe(
      'Boys hostel in Hyderabad · from ₹8,000/mo',
    );
  });

  // A share is the moment someone vouches for a place to a friend. "★0.0" or
  // "No rating" there reads worse than saying nothing.
  it('omits a rating rather than showing a hollow one', () => {
    expect(buildShareSummary({ city: 'Hyderabad', hostelType: 'GIRLS', rating: 0, reviewCount: 0 })).toBe(
      'Girls hostel in Hyderabad',
    );
    expect(buildShareSummary({ city: 'Hyderabad', rating: 4.6, reviewCount: 0 })).not.toContain('★');
  });

  it('shows a rating once there is one', () => {
    expect(buildShareSummary({ city: 'Hyderabad', hostelType: 'BOYS', rating: 4.6, reviewCount: 12 })).toContain('★4.6');
  });

  it('falls back to a neutral kind for co-living and unset types', () => {
    expect(buildShareSummary({ city: 'Goa', hostelType: 'CO_LIVING' })).toBe('Hostel in Goa');
    expect(buildShareSummary({ city: null, hostelType: null })).toBe('Hostel');
  });
});
