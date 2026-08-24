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

  it('names an empty meal rather than silently omitting it', () => {
    expect(buildKitchenMessage({ grid, now: THURSDAY, hostelName: 'H' })).toMatch(new RegExp(`Snacks\\s+${EMPTY_CELL_LABEL}`));
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

  it('handles an entirely empty grid without throwing', () => {
    const msg = buildKitchenMessage({ grid: [], now: THURSDAY, hostelName: 'H' });
    expect(msg).toContain(EMPTY_CELL_LABEL);
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
