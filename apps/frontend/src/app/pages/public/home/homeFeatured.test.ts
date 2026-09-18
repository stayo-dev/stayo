import { describe, expect, it } from 'vitest';
import type { DiscoverCard } from '@features/discover/api';
import { homeSupplyState, planFeatured, EDITORIAL_MAX, GRID_MAX } from './homeFeatured';

function card(id: string, photos: string[] = []): DiscoverCard {
  return {
    id,
    slug: id,
    name: id,
    city: 'Pune',
    address: 'A',
    latitude: null,
    longitude: null,
    hostel_type: 'BOYS',
    food_included: false,
    verified: true,
    photos,
    listed_at: '2026-01-01T00:00:00.000Z',
    vacant_beds: 2,
    starting_price: 7000,
    sharing: [2],
  } as DiscoverCard;
}

describe('planFeatured', () => {
  it('omits the section entirely when there is nothing to show', () => {
    expect(planFeatured([])).toEqual({ layout: 'none', cards: [], lead: null, showBrowseAll: false });
  });

  it('shows one to three listings editorially, with no browse-all link', () => {
    const plan = planFeatured([card('a'), card('b')]);
    expect(plan.layout).toBe('editorial');
    expect(plan.cards).toHaveLength(2);
    expect(plan.showBrowseAll).toBe(false);
  });

  it('switches to a capped grid past the editorial maximum', () => {
    const many = Array.from({ length: 9 }, (_, i) => card(`h${i}`));
    const plan = planFeatured(many);
    expect(plan.layout).toBe('grid');
    expect(plan.cards).toHaveLength(GRID_MAX);
    expect(plan.showBrowseAll).toBe(true);
  });

  it('prefers a listing that actually has a photograph as the lead', () => {
    const plan = planFeatured([card('no-photo'), card('has-photo', ['https://ik.imagekit.io/x/a.jpg'])]);
    expect(plan.lead?.id).toBe('has-photo');
  });

  it('falls back to the first listing when none has a photograph', () => {
    expect(planFeatured([card('a'), card('b')]).lead?.id).toBe('a');
  });

  it('treats exactly EDITORIAL_MAX as editorial', () => {
    const exact = Array.from({ length: EDITORIAL_MAX }, (_, i) => card(`h${i}`));
    expect(planFeatured(exact).layout).toBe('editorial');
  });
});

describe('homeSupplyState', () => {
  it('is loading while the query is in flight, even with nothing yet', () => {
    expect(homeSupplyState(true, 0)).toBe('loading');
  });

  it('stays loading when a refetch is in flight over existing cards', () => {
    expect(homeSupplyState(true, 3)).toBe('loading');
  });

  it('is empty only once the query has settled with nothing', () => {
    expect(homeSupplyState(false, 0)).toBe('empty');
  });

  it('is ready when listings exist', () => {
    expect(homeSupplyState(false, 2)).toBe('ready');
  });
});
