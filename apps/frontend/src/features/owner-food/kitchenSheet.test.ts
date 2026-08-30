import { describe, expect, it } from 'vitest';
import { buildKitchenMessage, whatsappShareUrl } from './kitchenSheet';
import { toWeekGrid, EMPTY_CELL_LABEL } from './weekGrid';

let nextItemId = 0;
function mealItem(name: string, menuItemId: string | null = 'i1', displayOrder = 0) {
  return { id: `item-${nextItemId++}`, menu_item_id: menuItemId, item_name: name, display_order: displayOrder };
}
const cell = (day: string, meal: string, items: ReturnType<typeof mealItem>[]) => ({
  id: `${day}-${meal}`, day_of_week: day, meal_type: meal, food_schedule_meal_items: items,
});

const grid = toWeekGrid([
  cell('THURSDAY', 'BREAKFAST', [mealItem('Dosa')]), cell('THURSDAY', 'LUNCH', [mealItem('Sambar Rice')]),
  cell('THURSDAY', 'SNACKS', []), cell('THURSDAY', 'DINNER', [mealItem('Chapati')]),
  cell('FRIDAY', 'BREAKFAST', [mealItem('Idli')]), cell('FRIDAY', 'LUNCH', [mealItem('Curd Rice')]),
  cell('FRIDAY', 'SNACKS', [mealItem('Bajji')]), cell('FRIDAY', 'DINNER', [mealItem('Paneer Curry')]),
]);

const THURSDAY = new Date('2026-08-06T09:00:00');

describe('buildKitchenMessage', () => {
  it('leads with the hostel name and today’s date', () => {
    const msg = buildKitchenMessage({ grid, now: THURSDAY, hostelName: 'Sri Adithya' });
    expect(msg).toContain('Sri Adithya');
    expect(msg).toContain('Thursday');
    expect(msg).toContain('6 August');
  });

  it('lists all four of today’s meals in order', () => {
    const msg = buildKitchenMessage({ grid, now: THURSDAY, hostelName: 'Sri Adithya' });
    expect(msg.indexOf('Dosa')).toBeGreaterThan(-1);
    expect(msg.indexOf('Dosa')).toBeLessThan(msg.indexOf('Sambar Rice'));
    expect(msg.indexOf('Sambar Rice')).toBeLessThan(msg.indexOf('Chapati'));
  });

  it('marks a one-off gap with a dash, in a meal the kitchen does run', () => {
    // Snacks is empty on Thursday but served on Friday, so the meal stays and
    // Thursday reads as a dash. A dash is information for a cook; "Not set"
    // describes the app rather than the kitchen.
    const msg = buildKitchenMessage({ grid, now: THURSDAY, hostelName: 'H' });
    expect(msg).toContain('*Snacks*\n—');
    expect(msg).not.toContain(EMPTY_CELL_LABEL);
  });

  it('drops a meal the kitchen never runs all week', () => {
    // Otherwise every message carries "Snacks —", which reads as an
    // unfinished menu rather than a hostel that serves no evening snack.
    const noSnacks = toWeekGrid([
      cell('THURSDAY', 'BREAKFAST', [mealItem('Dosa')]),
      cell('THURSDAY', 'LUNCH', [mealItem('Sambar Rice')]),
      cell('THURSDAY', 'DINNER', [mealItem('Chapati')]),
    ]);
    const msg = buildKitchenMessage({ grid: noSnacks, now: THURSDAY, hostelName: 'H' });
    expect(msg).not.toContain('Snacks');
    expect(msg).toContain('Breakfast');
    expect(msg).toContain('Dinner');
  });

  it('tidies dish names typed before the app started doing it', () => {
    const scruffy = toWeekGrid([cell('THURSDAY', 'BREAKFAST', [mealItem('bonda'), mealItem('idly')])]);
    const msg = buildKitchenMessage({ grid: scruffy, now: THURSDAY, hostelName: 'H' });
    expect(msg).toContain('Bonda');
    expect(msg).toContain('Idly');
  });

  it('gives tomorrow one labelled line per meal', () => {
    // It used to join all four with "·" into a single run, so nothing marked
    // where breakfast ended and lunch began — on the line whose whole job is
    // telling a cook what to prepare tonight.
    const msg = buildKitchenMessage({ grid, now: THURSDAY, hostelName: 'H' });
    expect(msg).toContain('Breakfast: Idli');
    expect(msg).toContain('Lunch: Curd Rice');
    expect(msg).toContain('Dinner: Paneer Curry');
  });

  it('prints serving windows when the hostel has set them', () => {
    const msg = buildKitchenMessage({
      grid,
      now: THURSDAY,
      hostelName: 'H',
      timings: {
        breakfast: { start: '07:00', end: '09:00', enabled: true },
        lunch: { start: '12:30', end: '14:00', enabled: true },
        snacks: { start: '17:00', end: '18:00', enabled: true },
        dinner: { start: '19:00', end: '21:00', enabled: true },
      },
    });
    expect(msg).toContain('Breakfast (7:00 AM – 9:00 AM)');
  });

  it('omits the window for a meal the hostel has switched off', () => {
    const msg = buildKitchenMessage({
      grid,
      now: THURSDAY,
      hostelName: 'H',
      timings: {
        breakfast: { start: '07:00', end: '09:00', enabled: false },
        lunch: { start: '12:30', end: '14:00', enabled: true },
        snacks: { start: '17:00', end: '18:00', enabled: true },
        dinner: { start: '19:00', end: '21:00', enabled: true },
      },
    });
    expect(msg).toContain('*Breakfast*');
    expect(msg).not.toContain('Breakfast (');
  });

  it('includes tomorrow, because prep starts the night before', () => {
    const msg = buildKitchenMessage({ grid, now: THURSDAY, hostelName: 'H' });
    expect(msg).toContain('Tomorrow');
    expect(msg).toContain('Idli');
    expect(msg).toContain('Paneer Curry');
  });

  it('wraps from Sunday to Monday for tomorrow', () => {
    const sundayGrid = toWeekGrid([cell('SUNDAY', 'LUNCH', [mealItem('Biryani')]), cell('MONDAY', 'LUNCH', [mealItem('Dal Rice')])]);
    const msg = buildKitchenMessage({ grid: sundayGrid, now: new Date('2026-08-09T09:00:00'), hostelName: 'H' });
    expect(msg).toContain('Dal Rice');
  });

  it('handles an entirely empty grid without throwing, keeping every meal', () => {
    // A schedule nobody has started is a week to fill in, not a hostel that
    // serves no food — so all four meals stay, each showing a dash.
    const msg = buildKitchenMessage({ grid: [], now: THURSDAY, hostelName: 'H' });
    expect(msg).toContain('*Breakfast*\n—');
    expect(msg).toContain('*Dinner*\n—');
    expect(msg).not.toContain(EMPTY_CELL_LABEL);
  });

  it('lists every dish of a multi-item meal, joined with the shared separator', () => {
    const multiGrid = toWeekGrid([
      cell('THURSDAY', 'LUNCH', [mealItem('Rice', 'r', 0), mealItem('Dal', 'd', 1), mealItem('Curry', 'c', 2), mealItem('Chutney', 'ch', 3)]),
    ]);
    const msg = buildKitchenMessage({ grid: multiGrid, now: THURSDAY, hostelName: 'H' });
    expect(msg).toContain('Rice • Dal • Curry • Chutney');
  });
});

describe('whatsappShareUrl', () => {
  it('builds a wa.me url with the message encoded', () => {
    expect(whatsappShareUrl('Hello world')).toBe('https://wa.me/?text=Hello%20world');
  });

  it('encodes newlines and asterisks so formatting survives', () => {
    const url = whatsappShareUrl('*Bold*\nSecond line');
    expect(url).toContain('%2A');
    expect(url).toContain('%0A');
    expect(url).not.toContain('\n');
  });
});
