import { describe, expect, it } from 'vitest';
import { currentStay, formatStayDate, historySummaryLine, stayDuration, stayLine } from './staySummary';

const live = { is_current: true, hostel_name: 'Sunrise Residency', room_no: '105', start_date: '2026-08-24', duration_months: 3 };
const past = { is_current: false, hostel_name: 'Old Place', room_no: '12', start_date: '2025-06-01', duration_months: 11 };

describe('finding the live stay', () => {
  it('picks the current one out of the record', () => {
    expect(currentStay({ stays: [past, live] })).toBe(live);
  });

  it('returns nothing for someone who is only browsing', () => {
    expect(currentStay({ stays: [past] })).toBeNull();
    expect(currentStay(null)).toBeNull();
  });
});

describe('formatting', () => {
  // new Date(iso) applies the viewer's timezone and shifts the day west of UTC.
  it('formats a date from integer parts', () => {
    expect(formatStayDate('2026-08-24')).toBe('24 Aug 2026');
    expect(formatStayDate('2026-01-01')).toBe('1 Jan 2026');
  });

  it('says nothing for a missing or malformed date', () => {
    expect(formatStayDate(null)).toBe('');
    expect(formatStayDate('24-08-2026')).toBe('');
  });

  it('builds a line from only what is known', () => {
    expect(stayLine(live)).toBe('Room 105 · since 24 Aug 2026');
    expect(stayLine({ is_current: true, room_no: null, start_date: '2026-08-24' })).toBe('since 24 Aug 2026');
    expect(stayLine({ is_current: true, room_no: '105', start_date: null })).toBe('Room 105');
    expect(stayLine(null)).toBe('');
  });

  it('omits a duration shorter than a month rather than saying "0 months"', () => {
    expect(stayDuration(live)).toBe('3 months so far');
    expect(stayDuration({ duration_months: 1 })).toBe('1 month so far');
    expect(stayDuration({ duration_months: 0 })).toBe('');
    expect(stayDuration({ duration_months: null })).toBe('');
  });
});

describe('the stay-history line', () => {
  // The bug: total_stays counts only stays where is_current is false, so a
  // person in their first hostel was shown "0 past stays" — on the profile of
  // someone who is, right then, living somewhere.
  it('counts the stay the person is currently in', () => {
    const line = historySummaryLine({ stays: [live], total_stays: 0 });
    expect(line).not.toContain('0');
    expect(line).toContain('1 stay');
    expect(line).toContain('including this one');
  });

  it('adds the current stay to the past ones', () => {
    expect(historySummaryLine({ stays: [past, live], total_stays: 1 })).toContain('2 stays');
  });

  it('reports past stays alone when there is no current one', () => {
    const line = historySummaryLine({ stays: [past], total_stays: 1 });
    expect(line).toContain('1 stay');
    expect(line).not.toContain('including this one');
  });

  it('invites rather than counts when there is nothing yet', () => {
    expect(historySummaryLine({ stays: [], total_stays: 0 })).toBe('Where you’ve stayed, and who can see it');
    expect(historySummaryLine(null)).toBe('Where you’ve stayed, and who can see it');
  });
});
