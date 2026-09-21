import { describe, it, expect } from 'vitest';
import {
  summariseQuota,
  toEnquiryView,
  orderEnquiries,
  countLocked,
} from './partnerPortal';
import type { PartnerEnquiryRow } from '@features/partner/api';

const row = (over: Partial<PartnerEnquiryRow> = {}): PartnerEnquiryRow => ({
  id: 'd1',
  state: 'SENT',
  received_at: '2026-09-20T10:00:00Z',
  hostel_name: 'Sunrise',
  student_name: 'Abhishek Rao',
  student_phone: '+919876543210',
  token: 'tok-1',
  ...over,
});

describe('the free-enquiry counter', () => {
  it('counts up to the quota', () => {
    expect(summariseQuota({ delivered: 2, quota: 3 }).line).toBe('2 of 3 free enquiries used');
    expect(summariseQuota({ delivered: 2, quota: 3 }).remaining).toBe(1);
    expect(summariseQuota({ delivered: 2, quota: 3 }).exhausted).toBe(false);
  });

  it('says so plainly once exhausted', () => {
    const s = summariseQuota({ delivered: 3, quota: 3 });
    expect(s.exhausted).toBe(true);
    expect(s.line).toBe('All 3 free enquiries used');
  });

  // Over-delivery is a designed outcome of counting confirmed deliveries
  // only, so the UI must not render "4 of 3" or a negative remainder.
  it('never shows a negative remainder when more were delivered than the quota', () => {
    const s = summariseQuota({ delivered: 5, quota: 3 });
    expect(s.remaining).toBe(0);
    expect(s.exhausted).toBe(true);
  });

  it('is safe on junk input', () => {
    expect(summariseQuota({ delivered: NaN as any, quota: undefined as any }).remaining).toBe(0);
  });
});

describe('how one enquiry reads', () => {
  it('shows the number once it is theirs', () => {
    const v = toEnquiryView(row());
    expect(v.locked).toBe(false);
    expect(v.detail).toBe('+919876543210');
    expect(v.href).toBe('/partner/enquiry/tok-1');
  });

  /**
   * A locked enquiry must look like a real person they are missing, not an
   * empty slot: hiding it would read as a malfunction, and showing the
   * number would make the gate pointless.
   */
  it('shows a locked enquiry as real, without the contact', () => {
    const v = toEnquiryView(row({ state: 'HELD', student_name: 'Abhi', student_phone: '••••••3210', token: null }));
    expect(v.locked).toBe(true);
    expect(v.title).toContain('Abhi');
    expect(v.detail).not.toContain('3210');
    expect(v.href).toBeNull();
  });

  it('never renders an empty name', () => {
    expect(toEnquiryView(row({ student_name: '' })).title).toBe('A student');
  });

  it('says so when a student left no number', () => {
    expect(toEnquiryView(row({ student_phone: null })).detail).toBe('No number provided');
  });
});

describe('the order they appear in', () => {
  const held = row({ id: 'h', state: 'HELD', received_at: '2026-09-18T10:00:00Z' });
  const recent = row({ id: 'r', received_at: '2026-09-21T10:00:00Z' });
  const older = row({ id: 'o', received_at: '2026-09-19T10:00:00Z' });

  // Locked rows are the only ones the partner cannot act on. Burying them
  // under the ones they can would hide what the page exists to show.
  it('puts locked enquiries first even when they are the oldest', () => {
    expect(orderEnquiries([recent, older, held]).map((r) => r.id)).toEqual(['h', 'r', 'o']);
  });

  it('sorts newest first within each group', () => {
    expect(orderEnquiries([older, recent]).map((r) => r.id)).toEqual(['r', 'o']);
  });

  it('is safe on an empty or missing list', () => {
    expect(orderEnquiries([])).toEqual([]);
    expect(orderEnquiries(undefined as any)).toEqual([]);
  });
});

describe('how many are waiting behind the gate', () => {
  it('counts only held enquiries', () => {
    expect(countLocked({ enquiries: [row(), row({ state: 'HELD' }), row({ state: 'RELEASED' })] })).toBe(1);
  });

  it('is safe on nothing', () => {
    expect(countLocked(null)).toBe(0);
    expect(countLocked(undefined)).toBe(0);
  });
});
