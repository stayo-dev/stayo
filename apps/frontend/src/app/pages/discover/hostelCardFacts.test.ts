import { describe, expect, it } from 'vitest';
import type { DiscoverCard } from '@features/discover/api';
import { availabilityFact, hostelCardFacts, locationLabel, sharingSummary } from './hostelCardFacts';

function card(overrides: Partial<DiscoverCard> = {}): DiscoverCard {
  return {
    id: 'h1',
    slug: 'sunrise-residency',
    name: 'Sunrise Residency',
    city: 'Hyderabad',
    address: 'Ameerpet',
    hostel_type: 'BOYS',
    food_included: true,
    verified: true,
    photos: ['https://img/1.jpg'],
    listed_at: '2026-01-01T00:00:00.000Z',
    vacant_beds: 12,
    starting_price: 8000,
    sharing: [2, 4],
    ...overrides,
  };
}

describe('availabilityFact', () => {
  it('says a bed exists rather than counting to 157', () => {
    expect(availabilityFact(157)).toEqual({ label: 'Beds available', tone: 'open' });
    expect(availabilityFact(5)).toEqual({ label: 'Beds available', tone: 'open' });
  });

  it('spells out the count only when it is scarce enough to act on', () => {
    expect(availabilityFact(4)).toEqual({ label: '4 beds left', tone: 'scarce' });
    expect(availabilityFact(1)).toEqual({ label: '1 bed left', tone: 'scarce' });
  });

  it('states a full hostel instead of leaving the slot blank', () => {
    expect(availabilityFact(0)).toEqual({ label: 'Fully booked', tone: 'full' });
  });

  it('treats junk vacancy as full rather than rendering NaN', () => {
    expect(availabilityFact(Number.NaN).tone).toBe('full');
    expect(availabilityFact(-3).tone).toBe('full');
  });
});

describe('locationLabel', () => {
  it('does not repeat a city an owner also typed into the address', () => {
    expect(locationLabel('Hyderabad', 'Hyderabad')).toBe('Hyderabad');
    expect(locationLabel('hyderabad', 'Hyderabad')).toBe('hyderabad');
  });

  it('keeps a genuine locality alongside the city', () => {
    expect(locationLabel('Samskruthi Nilayam', 'Hyderabad')).toBe('Samskruthi Nilayam, Hyderabad');
  });

  it('survives either half being missing', () => {
    expect(locationLabel('', 'Hyderabad')).toBe('Hyderabad');
    expect(locationLabel('Ameerpet', null)).toBe('Ameerpet');
    expect(locationLabel(null, null)).toBe('');
  });
});

describe('hostelCardFacts', () => {
  it('caps the chip list the compact card renders', () => {
    // Only the Saved list draws chips now; the square card summarises instead.
    expect(hostelCardFacts(card({ sharing: [1, 2, 3, 4, 6] })).sharing)
      .toEqual(['Single', '2-bed', '3-bed']);
  });

  it('leaves a short room list alone', () => {
    expect(hostelCardFacts(card({ sharing: [2, 4] })).sharing).toEqual(['2-bed', '4-bed']);
  });

  it('carries price, audience, meals and photo through', () => {
    const facts = hostelCardFacts(card());
    expect(facts.price).toBe('₹8,000');
    expect(facts.audience).toBe('Boys');
    expect(facts.meals).toBe(true);
    expect(facts.photo).toBe('https://img/1.jpg');
    expect(facts.location).toBe('Ameerpet, Hyderabad');
  });

  it('leaves an unpriced hostel unpriced instead of showing zero', () => {
    expect(hostelCardFacts(card({ starting_price: null })).price).toBeNull();
  });

  it('handles a hostel with no photo and no rooms', () => {
    const facts = hostelCardFacts(card({ photos: [], sharing: [], hostel_type: null }));
    expect(facts.photo).toBeNull();
    expect(facts.sharing).toEqual([]);
    expect(facts.audience).toBeNull();
  });
});

describe('sharingSummary', () => {
  it('names the room type outright when there is only one', () => {
    expect(sharingSummary(['4-bed'])).toBe('4-bed');
    expect(sharingSummary(['Single'])).toBe('Single');
  });

  it('leads with the smallest and counts the rest, because width is the constraint', () => {
    expect(sharingSummary(['2-bed', '4-bed'])).toBe('2-bed +1');
    expect(sharingSummary(['Single', '2-bed', '4-bed', '6-bed'])).toBe('Single +3');
  });

  it('says nothing for a hostel with no rooms rather than an empty phrase', () => {
    expect(sharingSummary([])).toBeNull();
  });

  it('is carried on the facts, capped chips and all', () => {
    const facts = hostelCardFacts(card({ sharing: [1, 2, 3, 4, 6] }));
    // Counts every room type, not just the three that used to fit as chips.
    expect(facts.sharingSummary).toBe('Single +4');
    expect(hostelCardFacts(card({ sharing: [] })).sharingSummary).toBeNull();
  });
});
