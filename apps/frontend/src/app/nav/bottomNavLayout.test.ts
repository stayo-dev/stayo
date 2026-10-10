import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ACTIVE_TENANT_TABS, EXPLORE_PROFILE_TABS } from './appNavConfig';
import {
  MAX_VISIBLE_BOTTOM_TABS,
  bottomNavScrolls,
  hasHiddenTabsToTheRight,
  scrollLeftToReveal,
} from './bottomNavLayout';

describe('five tabs visible, the sixth a swipe away', () => {
  it('the live-tenant nav (six tabs) scrolls, with Explore last', () => {
    expect(ACTIVE_TENANT_TABS).toHaveLength(6);
    expect(ACTIVE_TENANT_TABS[MAX_VISIBLE_BOTTOM_TABS].label).toBe('Explore');
    expect(bottomNavScrolls(ACTIVE_TENANT_TABS.length)).toBe(true);
  });

  it('two to five tabs share the width and never scroll', () => {
    expect(bottomNavScrolls(EXPLORE_PROFILE_TABS.length)).toBe(false);
    for (const n of [1, 2, 3, 4, 5]) expect(bottomNavScrolls(n)).toBe(false);
  });

  it('each scrolling tab is exactly a fifth of the bar on mobile, back to 76px on the desktop dock', () => {
    const src = fs.readFileSync(
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../components/AppBottomNav.tsx'),
      'utf8',
    );
    expect(src).toMatch(/flex-none basis-1\/5 snap-start/);
    expect(src).toMatch(/snap-x snap-mandatory lg:snap-none/);
    expect(src).toMatch(/basis-1\/5 snap-start[^']*lg:w-\[76px\] lg:basis-auto/);
  });
});

describe('the "more tabs" fade', () => {
  // 375px phone, six tabs of 75px = 450px of content.
  it('shows at rest, while Explore is past the edge', () => {
    expect(hasHiddenTabsToTheRight({ scrollLeft: 0, clientWidth: 375, scrollWidth: 450 })).toBe(true);
  });

  it('goes once scrolled to the end, allowing for sub-pixel rounding', () => {
    expect(hasHiddenTabsToTheRight({ scrollLeft: 75, clientWidth: 375, scrollWidth: 450 })).toBe(false);
    expect(hasHiddenTabsToTheRight({ scrollLeft: 72.5, clientWidth: 375, scrollWidth: 450 })).toBe(false);
  });

  it('never shows when nothing overflows', () => {
    expect(hasHiddenTabsToTheRight({ scrollLeft: 0, clientWidth: 375, scrollWidth: 375 })).toBe(false);
  });
});

describe('the active tab is brought into view', () => {
  const box = { scrollLeft: 0, clientWidth: 375 };

  it('on Explore (sixth tab), the bar scrolls just enough to show it', () => {
    expect(scrollLeftToReveal({ offsetLeft: 375, offsetWidth: 75 }, box)).toBe(75);
  });

  it('a tab already in view never moves the bar', () => {
    expect(scrollLeftToReveal({ offsetLeft: 0, offsetWidth: 75 }, box)).toBeNull();
    expect(scrollLeftToReveal({ offsetLeft: 300, offsetWidth: 75 }, box)).toBeNull();
  });

  it('back on Home after Explore, the bar returns to the start', () => {
    expect(scrollLeftToReveal({ offsetLeft: 0, offsetWidth: 75 }, { scrollLeft: 75, clientWidth: 375 })).toBe(0);
  });
});
