import { describe, it, expect } from 'vitest';
import { notFoundAudience, notFoundCopy, wrapsInMarketingLayout } from './notFoundAudience';

describe('notFoundAudience', () => {
  it('reads an owner path as the owner console', () => {
    expect(notFoundAudience('/owner/hostels/abc/nope')).toBe('owner');
    expect(notFoundAudience('/owner')).toBe('owner');
  });

  it('reads the tenant app and its takeover routes as tenant', () => {
    expect(notFoundAudience('/tenant/money/typo')).toBe('tenant');
    expect(notFoundAudience('/stay/some-hostel/oops')).toBe('tenant');
    expect(notFoundAudience('/payment-return/x')).toBe('tenant');
  });

  it('reads anything else as public', () => {
    expect(notFoundAudience('/')).toBe('public');
    expect(notFoundAudience('/hostels/green-nest')).toBe('public');
    expect(notFoundAudience('/explore')).toBe('public');
  });

  it('matches whole segments, not prefixes', () => {
    // `/ownership-transfer` is not the owner console, and `/stayo-guide` is
    // not the stay scanner. A naive startsWith would claim both.
    expect(notFoundAudience('/ownership-transfer')).toBe('public');
    expect(notFoundAudience('/stayo-guide')).toBe('public');
  });

  it('is case-insensitive', () => {
    expect(notFoundAudience('/Owner/Home/Nope')).toBe('owner');
  });

  it('treats an empty or missing path as public', () => {
    expect(notFoundAudience('')).toBe('public');
    expect(notFoundAudience(undefined as unknown as string)).toBe('public');
  });
});

describe('notFoundCopy — every audience is offered its own app', () => {
  it('never offers an owner a hostel to rent', () => {
    // The bug: an owner deep in their console was shown the marketing page's
    // "Find a stay" call to action.
    const copy = notFoundCopy('/owner/hostels/abc/nope');
    const destinations = [copy.primary, copy.secondary].filter(Boolean).map((l) => l!.to);
    expect(destinations.every((to) => to.startsWith('/owner'))).toBe(true);
    expect(JSON.stringify(copy)).not.toMatch(/find a stay/i);
  });

  it('keeps a tenant inside the tenant app', () => {
    const copy = notFoundCopy('/tenant/money/typo');
    const destinations = [copy.primary, copy.secondary].filter(Boolean).map((l) => l!.to);
    expect(destinations.every((to) => to.startsWith('/tenant'))).toBe(true);
  });

  it('reassures a tenant that nothing about their stay changed', () => {
    expect(notFoundCopy('/tenant/oops').body).toMatch(/stay has changed/i);
  });

  it('keeps the building metaphor on the public site', () => {
    expect(notFoundCopy('/nope').title).toBe("This room doesn't exist");
  });

  it('gives every audience somewhere to go', () => {
    for (const path of ['/owner/x', '/tenant/x', '/nope']) {
      const copy = notFoundCopy(path);
      expect(copy.primary.to).toBeTruthy();
      expect(copy.primary.label).toBeTruthy();
    }
  });
});

describe('wrapsInMarketingLayout', () => {
  it('wraps only the public 404', () => {
    expect(wrapsInMarketingLayout('public')).toBe(true);
  });

  it('never wraps inside a signed-in shell, which already has its own nav', () => {
    expect(wrapsInMarketingLayout('owner')).toBe(false);
    expect(wrapsInMarketingLayout('tenant')).toBe(false);
  });
});
