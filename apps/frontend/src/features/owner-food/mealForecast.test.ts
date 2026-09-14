import { describe, expect, it } from 'vitest';
import { canLogNow, entryFor, expectedLabel, honestyLine, SLOT_TO_MEAL_TYPE, type ForecastMealEntry, type MealForecast } from './mealForecast';

const entry = (over: Partial<ForecastMealEntry> = {}): ForecastMealEntry => ({
  mealType: 'DINNER', expected: 31, basis: 'headcount', samples: 0, ratio: 1, headcount: 31, served: null, ...over,
});
const forecast: MealForecast = {
  today: '2026-09-14',
  days: [
    { date: '2026-09-14', meals: [entry({ mealType: 'BREAKFAST', served: 27 }), entry()] },
    { date: '2026-09-15', meals: [entry({ mealType: 'DINNER', expected: 28, basis: 'learned', samples: 9 })] },
  ],
};
const timings = {
  BREAKFAST: { start: '07:00', end: '09:00', enabled: true },
  LUNCH: { start: '12:30', end: '14:00', enabled: true },
  SNACKS: { start: '17:00', end: '18:00', enabled: false },
  DINNER: { start: '20:00', end: '22:00', enabled: true },
};

describe('slot mapping', () => {
  it('bridges the kitchen sheet lowercase keys and the API uppercase ones', () => {
    expect(SLOT_TO_MEAL_TYPE.dinner).toBe('DINNER');
    expect(SLOT_TO_MEAL_TYPE.snacks).toBe('SNACKS');
  });
});

describe('entryFor', () => {
  it('finds a day and meal, or says there is none', () => {
    expect(entryFor(forecast, '2026-09-14', 'breakfast')?.served).toBe(27);
    expect(entryFor(forecast, '2026-09-15', 'dinner')?.expected).toBe(28);
    expect(entryFor(forecast, '2026-09-16', 'dinner')).toBeNull();
    expect(entryFor(undefined, '2026-09-14', 'dinner')).toBeNull();
  });
});

describe('copy', () => {
  it('marks a learned number as an estimate and leaves a headcount bare', () => {
    expect(expectedLabel(entry({ basis: 'learned', expected: 28 }))).toBe('≈ 28');
    expect(expectedLabel(entry({ expected: 31 }))).toBe('31');
  });

  it('always says which of the two it is', () => {
    expect(honestyLine(entry({ basis: 'learned', samples: 9 }))).toBe('from the last 2 weeks');
    expect(honestyLine(entry())).toBe('still learning what people actually eat');
  });
});

describe('canLogNow — ask only for meals that have happened', () => {
  const args = { slot: 'breakfast' as const, timings, isToday: true };
  it('asks once the serving window has closed', () => {
    expect(canLogNow({ ...args, entry: entry({ served: null }), nowHHmm: '09:30' })).toBe(true);
  });
  it('does not ask during or before the meal', () => {
    expect(canLogNow({ ...args, entry: entry({ served: null }), nowHHmm: '08:30' })).toBe(false);
    expect(canLogNow({ ...args, entry: entry({ served: null }), nowHHmm: '06:00' })).toBe(false);
  });
  it('still allows a correction after it has been logged', () => {
    expect(canLogNow({ ...args, entry: entry({ served: 27 }), nowHHmm: '09:30' })).toBe(true);
  });
  it('never asks about a meal the hostel does not serve', () => {
    expect(canLogNow({ ...args, slot: 'snacks', entry: entry(), nowHHmm: '23:00' })).toBe(false);
  });
  it('asks about yesterday whatever the clock says, and never about a meal it has no entry for', () => {
    expect(canLogNow({ ...args, isToday: false, entry: entry(), nowHHmm: '01:00' })).toBe(true);
    expect(canLogNow({ ...args, entry: null, nowHHmm: '23:00' })).toBe(false);
  });
});
