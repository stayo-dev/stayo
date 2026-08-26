import { describe, expect, it } from 'vitest';
import {
  AVAILABILITY_OPTIONS,
  describeAvailability,
  needsValue,
  normaliseAvailability,
  placeholderFor,
  summariseAvailability,
  formatSlot,
  formatSlots,
  isCompleteSlot,
  needsSlots,
} from './amenityAvailability';

describe('the choice an owner is offered', () => {
  // The first attempt gave every amenity two free-text boxes. Eight amenities
  // meant sixteen empty inputs, most with no sensible answer — the chip already
  // says "CCTV security".
  it('leads with "nothing extra", because that is the common answer', () => {
    expect(AVAILABILITY_OPTIONS[0].kind).toBe('NONE');
  });

  it('offers exactly the three kinds of answer that exist', () => {
    expect(AVAILABILITY_OPTIONS.map((o) => o.kind)).toEqual(['NONE', 'ALWAYS', 'HOURS', 'NOTE']);
  });

  it('only asks for typing where typing is the point', () => {
    // Hours are picked from a dial, not typed — see needsSlots.
    expect(needsValue('NOTE')).toBe(true);
    expect(needsValue('HOURS')).toBe(false);
    expect(needsValue('ALWAYS')).toBe(false);
    expect(needsValue(null)).toBe(false);
  });

  it('shows a placeholder only where words are still typed', () => {
    expect(placeholderFor('NOTE')).toContain('power');
    expect(placeholderFor('HOURS')).toBe('');
    expect(placeholderFor(null)).toBe('');
  });
});

describe('normalising before it is saved', () => {
  it('keeps a note as typed', () => {
    expect(normaliseAvailability({ availability: 'NOTE', availabilityValue: ' Diesel genset ' })).toMatchObject({
      availability: 'NOTE',
      availabilityValue: 'Diesel genset',
    });
  });

  it('drops the value for ALWAYS, which needs no words', () => {
    expect(normaliseAvailability({ availability: 'ALWAYS', availabilityValue: 'ignored' })).toMatchObject({
      availability: 'ALWAYS',
      availabilityValue: null,
    });
  });

  // Someone who picked "Specific timings" and thought better of it should end
  // up with a clean amenity, not one advertising blank hours.
  it('falls back to nothing when a kind that needs a value has none', () => {
    expect(normaliseAvailability({ availability: 'HOURS', availabilitySlots: [] }).availability).toBeNull();
    expect(normaliseAvailability({ availability: 'NOTE', availabilityValue: '' }).availability).toBeNull();
  });

  it('treats an absent choice as nothing', () => {
    expect(normaliseAvailability({})).toMatchObject({ availability: null, availabilityValue: null });
  });
});

describe('how it renders for tenants and seekers', () => {
  it('puts a time range in the pill, where it can be scanned', () => {
    expect(
      describeAvailability({ availability: 'HOURS', availabilitySlots: [{ start: '06:00', end: '10:00' }] }),
    ).toEqual({ pill: '6–10 AM', line: null });
    expect(describeAvailability({ availability: 'ALWAYS' })).toEqual({ pill: '24×7', line: null });
  });

  // A pill that long stops being a pill.
  it('puts a sentence on its own line, not in a badge', () => {
    expect(describeAvailability({ availability: 'NOTE', availabilityValue: 'Runs when power goes off' })).toEqual({
      pill: null,
      line: 'Runs when power goes off',
    });
  });

  it('renders the label alone when there is nothing to add', () => {
    expect(describeAvailability({})).toEqual({ pill: null, line: null });
  });
});

describe('the owner’s one-line summary', () => {
  it('shows what is set', () => {
    expect(summariseAvailability({ availability: 'ALWAYS' })).toEqual({ text: '24×7', set: true });
    expect(summariseAvailability({ availability: 'NOTE', availabilityValue: 'Diesel genset' }).text).toBe('Diesel genset');
  });

  it('invites rather than looking broken when nothing is set', () => {
    const summary = summariseAvailability({});
    expect(summary.set).toBe(false);
    expect(summary.text).toMatch(/add/i);
  });
});

describe('timings are picked from a clock, not typed', () => {
  it('writes the meridiem once when both ends share it', () => {
    // "7 AM – 9 AM" is how a form thinks; "7–9 AM" is how a person says it.
    expect(formatSlot({ start: '07:00', end: '09:00' })).toBe('7–9 AM');
    expect(formatSlot({ start: '20:00', end: '22:00' })).toBe('8–10 PM');
  });

  it('writes both when the block crosses midday', () => {
    expect(formatSlot({ start: '11:00', end: '14:00' })).toBe('11 AM–2 PM');
  });

  it('shows minutes only when there are any', () => {
    expect(formatSlot({ start: '08:30', end: '22:00' })).toBe('8:30 AM–10 PM');
    expect(formatSlot({ start: '12:00', end: '14:00' })).toBe('12–2 PM');
    expect(formatSlot({ start: '00:00', end: '06:00' })).toBe('12–6 AM');
  });

  it('joins the day’s blocks the same way for every hostel', () => {
    expect(
      formatSlots([
        { start: '07:00', end: '09:00' },
        { start: '12:00', end: '14:00' },
        { start: '20:00', end: '22:00' },
      ]),
    ).toBe('7–9 AM · 12–2 PM · 8–10 PM');
  });

  it('treats a block that starts and ends at once as a typo', () => {
    expect(isCompleteSlot({ start: '09:00', end: '09:00' })).toBe(false);
    expect(isCompleteSlot({ start: '09:00', end: '' })).toBe(false);
    expect(isCompleteSlot(null)).toBe(false);
  });

  // Refusing this would force the owner to lie about a real overnight block.
  it('allows a block that runs past midnight', () => {
    expect(isCompleteSlot({ start: '22:00', end: '01:00' })).toBe(true);
  });

  it('drops half-filled blocks rather than saving a dash', () => {
    const saved = normaliseAvailability({
      availability: 'HOURS',
      availabilitySlots: [{ start: '07:00', end: '09:00' }, { start: '12:00', end: '' }],
    });
    expect(saved.availabilitySlots).toEqual([{ start: '07:00', end: '09:00' }]);
  });

  it('falls back to nothing when no block was completed', () => {
    expect(normaliseAvailability({ availability: 'HOURS', availabilitySlots: [] }).availability).toBeNull();
  });

  it('renders the day’s blocks as one scannable pill', () => {
    expect(
      describeAvailability({
        availability: 'HOURS',
        availabilitySlots: [{ start: '07:00', end: '09:00' }, { start: '20:00', end: '22:00' }],
      }),
    ).toEqual({ pill: '7–9 AM · 8–10 PM', line: null });
  });

  it('no longer asks for typing on the hours path', () => {
    expect(needsValue('HOURS')).toBe(false);
    expect(needsSlots('HOURS')).toBe(true);
    expect(needsSlots('NOTE')).toBe(false);
  });
});
