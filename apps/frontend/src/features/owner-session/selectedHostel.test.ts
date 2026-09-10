import { describe, it, expect } from 'vitest';
import { resolveSelectedHostel } from './selectedHostel';

const owned = ['h1', 'h2', 'h3'];

describe('resolveSelectedHostel', () => {
  it('prefers the route param over everything', () => {
    expect(
      resolveSelectedHostel({ paramId: 'h2', queryId: 'h3', storedId: 'h1', ownedHostelIds: owned }),
    ).toBe('h2');
  });

  it('falls to the query param when there is no route param', () => {
    expect(
      resolveSelectedHostel({ paramId: null, queryId: 'h3', storedId: 'h1', ownedHostelIds: owned }),
    ).toBe('h3');
  });

  it('falls to storage when there is neither param nor query', () => {
    expect(
      resolveSelectedHostel({ paramId: null, queryId: null, storedId: 'h1', ownedHostelIds: owned }),
    ).toBe('h1');
  });

  it('is null ("All hostels") when nothing is set', () => {
    expect(
      resolveSelectedHostel({ paramId: null, queryId: null, storedId: null, ownedHostelIds: owned }),
    ).toBeNull();
  });

  it('discards an id the owner no longer owns and tries the next candidate', () => {
    expect(
      resolveSelectedHostel({ paramId: 'gone', queryId: 'h2', storedId: null, ownedHostelIds: owned }),
    ).toBe('h2');
    expect(
      resolveSelectedHostel({ paramId: null, queryId: null, storedId: 'gone', ownedHostelIds: owned }),
    ).toBeNull();
  });

  it('is null when the owner owns no hostels', () => {
    expect(
      resolveSelectedHostel({ paramId: 'h1', queryId: 'h2', storedId: 'h3', ownedHostelIds: [] }),
    ).toBeNull();
  });
});
