import { describe, expect, it } from 'vitest';
import {
  currentAndNextMeal,
  DEFAULT_MEAL_TIMINGS,
  formatCountdown,
  formatTimeRange,
  mealStatusAt,
  minutesUntilStart,
  nextServingAt,
  type MealTimings,
} from './mealTimings';

const TIMINGS: MealTimings = {
  breakfast: { start: '07:00', end: '09:00', enabled: true },
  lunch: { start: '12:30', end: '14:00', enabled: true },
  snacks: { start: '17:00', end: '18:00', enabled: true },
  dinner: { start: '19:00', end: '21:00', enabled: true },
};

const at = (time: string) => new Date(`2026-08-19T${time}:00`);

describe('mealStatusAt', () => {
  it('is UPCOMING before start', () => {
    expect(mealStatusAt(TIMINGS.breakfast, at('06:59'))).toBe('UPCOMING');
  });
  it('is SERVING_NOW exactly at start', () => {
    expect(mealStatusAt(TIMINGS.breakfast, at('07:00'))).toBe('SERVING_NOW');
  });
  it('is SERVING_NOW just before end', () => {
    expect(mealStatusAt(TIMINGS.breakfast, at('08:59'))).toBe('SERVING_NOW');
  });
  it('is COMPLETED exactly at end (end-exclusive)', () => {
    expect(mealStatusAt(TIMINGS.breakfast, at('09:00'))).toBe('COMPLETED');
  });
  it('is COMPLETED well after end', () => {
    expect(mealStatusAt(TIMINGS.breakfast, at('10:00'))).toBe('COMPLETED');
  });
});

describe('minutesUntilStart', () => {
  it('counts down to a future start', () => {
    expect(minutesUntilStart(TIMINGS.lunch, at('12:00'))).toBe(30);
  });
  it('is 0 once serving has started', () => {
    expect(minutesUntilStart(TIMINGS.lunch, at('13:00'))).toBe(0);
  });
});

describe('formatCountdown', () => {
  it('says Serving Now while serving', () => {
    expect(formatCountdown(TIMINGS.lunch, at('13:00'))).toBe('Serving Now');
  });
  it('formats under an hour in minutes', () => {
    expect(formatCountdown(TIMINGS.dinner, at('18:18'))).toBe('Starts in 42 min');
  });
  it('formats exactly one hour without minutes', () => {
    expect(formatCountdown(TIMINGS.dinner, at('18:00'))).toBe('Starts in 1h');
  });
  it('formats over an hour with minutes', () => {
    expect(formatCountdown(TIMINGS.dinner, at('17:55'))).toBe('Starts in 1h 5m');
  });
  it('formats 1 minute in the singular-looking form (no special-casing needed)', () => {
    expect(formatCountdown(TIMINGS.breakfast, at('06:59'))).toBe('Starts in 1 min');
  });
});

describe('formatTimeRange', () => {
  it('formats a morning range', () => {
    expect(formatTimeRange(TIMINGS.breakfast)).toBe('7:00 AM – 9:00 AM');
  });
  it('formats a range crossing noon', () => {
    expect(formatTimeRange(TIMINGS.lunch)).toBe('12:30 PM – 2:00 PM');
  });
  it('formats midnight as 12 AM', () => {
    expect(formatTimeRange({ start: '00:00', end: '01:00', enabled: true })).toBe('12:00 AM – 1:00 AM');
  });
  it('formats noon as 12 PM', () => {
    expect(formatTimeRange({ start: '12:00', end: '13:00', enabled: true })).toBe('12:00 PM – 1:00 PM');
  });
});

describe('nextServingAt', () => {
  it('returns the currently-serving meal when one is serving', () => {
    expect(nextServingAt(TIMINGS, at('13:00'))).toEqual({ slot: 'lunch', entry: TIMINGS.lunch, status: 'SERVING_NOW' });
  });
  it('returns the soonest upcoming meal when nothing is serving', () => {
    expect(nextServingAt(TIMINGS, at('10:00'))).toEqual({ slot: 'lunch', entry: TIMINGS.lunch, status: 'UPCOMING' });
  });
  it('returns null once every enabled meal is done for the day', () => {
    expect(nextServingAt(TIMINGS, at('22:00'))).toBeNull();
  });
  it('skips a disabled meal entirely, even mid-window', () => {
    const noSnacks: MealTimings = { ...TIMINGS, snacks: { ...TIMINGS.snacks, enabled: false } };
    expect(nextServingAt(noSnacks, at('17:30'))).toEqual({ slot: 'dinner', entry: TIMINGS.dinner, status: 'UPCOMING' });
  });
});

describe('currentAndNextMeal', () => {
  it('shows breakfast as current in the early morning', () => {
    expect(currentAndNextMeal(TIMINGS, at('07:40'))).toEqual({ current: 'breakfast', next: 'lunch' });
  });
  it('shows dinner as current with nothing after it', () => {
    expect(currentAndNextMeal(TIMINGS, at('20:30'))).toEqual({ current: 'dinner', next: null });
  });
  it('before the first meal, that first meal is still current', () => {
    expect(currentAndNextMeal(TIMINGS, at('02:00'))).toEqual({ current: 'breakfast', next: 'lunch' });
  });
  it('skips a disabled meal for both current and next', () => {
    const noLunch: MealTimings = { ...TIMINGS, lunch: { ...TIMINGS.lunch, enabled: false } };
    expect(currentAndNextMeal(noLunch, at('13:00'))).toEqual({ current: 'breakfast', next: 'snacks' });
  });
});

describe('DEFAULT_MEAL_TIMINGS', () => {
  it('matches the spec defaults', () => {
    expect(DEFAULT_MEAL_TIMINGS).toEqual(TIMINGS);
  });
});
