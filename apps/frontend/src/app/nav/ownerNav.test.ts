import { describe, it, expect } from 'vitest';
import { buildOwnerNav, isNavItemActive } from './ownerNav';

describe('buildOwnerNav', () => {
  it('lists the six owner destinations in order', () => {
    const paths = buildOwnerNav().flatMap((g) => g.items).map((i) => i.to);
    expect(paths).toEqual([
      '/owner/home',
      '/owner/tenants',
      '/owner/money',
      '/owner/food',
      '/owner/hostels',
      '/owner/more',
    ]);
  });

  it('marks only Home as an exact match', () => {
    const items = buildOwnerNav().flatMap((g) => g.items);
    expect(items.find((i) => i.to === '/owner/home')?.end).toBe(true);
    expect(items.filter((i) => i.end).map((i) => i.to)).toEqual(['/owner/home']);
  });

  it('shows no badge without a count', () => {
    const items = buildOwnerNav().flatMap((g) => g.items);
    expect(items.every((i) => (i.badge ?? 0) === 0)).toBe(true);
  });

  it('surfaces collection and alert counts on Money and Settings', () => {
    const items = buildOwnerNav({ collect: 4, alerts: 2 }).flatMap((g) => g.items);
    expect(items.find((i) => i.to === '/owner/money')?.badge).toBe(4);
    expect(items.find((i) => i.to === '/owner/more')?.badge).toBe(2);
  });

  it('drops a zero or negative count rather than badging it', () => {
    const items = buildOwnerNav({ collect: 0, alerts: -1 }).flatMap((g) => g.items);
    expect(items.find((i) => i.to === '/owner/money')?.badge).toBe(0);
    expect(items.find((i) => i.to === '/owner/more')?.badge).toBe(0);
  });
});

describe('isNavItemActive', () => {
  it('lights an exact item only on its own path', () => {
    expect(isNavItemActive('/owner/home', '/owner/home', true)).toBe(true);
    expect(isNavItemActive('/owner/home', '/owner/home/anything', true)).toBe(false);
  });

  it('lights a prefix item on child routes', () => {
    expect(isNavItemActive('/owner/tenants', '/owner/tenants', false)).toBe(true);
    expect(isNavItemActive('/owner/tenants', '/owner/tenants/abc123', false)).toBe(true);
    expect(isNavItemActive('/owner/tenants', '/owner/money', false)).toBe(false);
  });
});
