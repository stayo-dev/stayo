import { describe, it, expect } from 'vitest';
import { headerFor, PAGE_HEADERS } from './appHeaders';

describe('headerFor', () => {
  it('returns the exact entry when the path is mapped', () => {
    expect(headerFor('/owner/tenants').title).toBe('Tenants');
    expect(headerFor('/tenant/room').title).toBe('My room');
  });

  it('falls through a detail route to its section header (longest prefix)', () => {
    expect(headerFor('/owner/tenants/abc123')).toEqual(PAGE_HEADERS['/owner/tenants']);
    expect(headerFor('/owner/hostels/h1/rooms')).toEqual(PAGE_HEADERS['/owner/hostels']);
  });

  it('prefers the more specific prefix', () => {
    // both '/owner/money' and '/owner/money/collect' are mapped
    expect(headerFor('/owner/money/collect').title).toBe("Today's collection");
    expect(headerFor('/owner/money/collect/whatever')).toEqual(PAGE_HEADERS['/owner/money/collect']);
  });

  it('gives a quiet generic fallback for an unmapped route', () => {
    expect(headerFor('/owner/something-new')).toEqual({ title: 'Stayo', subtitle: '' });
  });
});
