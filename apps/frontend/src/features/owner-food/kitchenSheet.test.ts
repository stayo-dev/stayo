import { describe, expect, it } from 'vitest';
import { buildKitchenMessage, whatsappShareUrl } from './kitchenSheet';
import { toWeekGrid, EMPTY_CELL_LABEL } from './weekGrid';

const cell = (day: string, meal: string, name: string, id: string | null = 'i1') => ({
  id: `${day}-${meal}`, day_of_week: day, meal_type: meal, menu_item_id: id, item_name: name,
});

const grid = toWeekGrid([
  cell('THURSDAY', 'BREAKFAST', 'Dosa'), cell('THURSDAY', 'LUNCH', 'Sambar Rice'),
  cell('THURSDAY', 'SNACKS', 'Not set', null), cell('THURSDAY', 'DINNER', 'Chapati'),
  cell('FRIDAY', 'BREAKFAST', 'Idli'), cell('FRIDAY', 'LUNCH', 'Curd Rice'),
  cell('FRIDAY', 'SNACKS', 'Bajji'), cell('FRIDAY', 'DINNER', 'Paneer Curry'),
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
    const sundayGrid = toWeekGrid([cell('SUNDAY', 'LUNCH', 'Biryani'), cell('MONDAY', 'LUNCH', 'Dal Rice')]);
    const msg = buildKitchenMessage({ grid: sundayGrid, now: new Date('2026-08-09T09:00:00'), hostelName: 'H' });
    expect(msg).toContain('Dal Rice');
  });

  it('handles an entirely empty grid without throwing', () => {
    const msg = buildKitchenMessage({ grid: [], now: THURSDAY, hostelName: 'H' });
    expect(msg).toContain(EMPTY_CELL_LABEL);
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
