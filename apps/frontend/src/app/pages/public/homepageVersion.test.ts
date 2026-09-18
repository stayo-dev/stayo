import { describe, expect, it } from 'vitest';
import { DEFAULT_HOMEPAGE_VERSION, resolveHomepageVersion } from './homepageVersion';

describe('resolveHomepageVersion', () => {
  it('serves the default when nothing says otherwise', () => {
    expect(resolveHomepageVersion()).toBe(DEFAULT_HOMEPAGE_VERSION);
    expect(resolveHomepageVersion({ envValue: undefined, search: '' })).toBe(DEFAULT_HOMEPAGE_VERSION);
  });

  it('lets the environment pin either version', () => {
    expect(resolveHomepageVersion({ envValue: 'chooser' })).toBe('chooser');
    expect(resolveHomepageVersion({ envValue: 'v2' })).toBe('v2');
  });

  it('lets a query parameter override the environment, for previewing a deploy', () => {
    expect(resolveHomepageVersion({ envValue: 'v2', search: '?homepage=chooser' })).toBe('chooser');
    expect(resolveHomepageVersion({ envValue: 'chooser', search: '?homepage=v2' })).toBe('v2');
  });

  it('accepts a search string with or without the leading question mark', () => {
    expect(resolveHomepageVersion({ search: 'homepage=chooser' })).toBe('chooser');
  });

  it('ignores an unrecognised value rather than breaking the front door', () => {
    expect(resolveHomepageVersion({ envValue: 'nonsense' })).toBe(DEFAULT_HOMEPAGE_VERSION);
    expect(resolveHomepageVersion({ envValue: 'chooser', search: '?homepage=nonsense' })).toBe('chooser');
  });

  it('keeps working when the query string is unparseable', () => {
    expect(resolveHomepageVersion({ envValue: 'chooser', search: '%%%' })).toBe('chooser');
  });
});
