import { describe, it, expect } from 'vitest';
import { findHostelInProgress } from './hostelInProgress';

const hostel = (over: Partial<Parameters<typeof findHostelInProgress>[0][number]> = {}) => ({
  id: 'h1',
  name: 'Sunrise Residency',
  status: 'ACTIVE',
  totalCapacity: 0,
  ...over,
});

describe('findHostelInProgress', () => {
  it('finds an active hostel with no rooms yet', () => {
    expect(findHostelInProgress([hostel()])?.id).toBe('h1');
  });

  it('ignores a hostel that already has rooms', () => {
    expect(findHostelInProgress([hostel({ totalCapacity: 18 })])).toBeNull();
  });

  // The production bug. The dashboard fetches include_archived: true so the
  // ARCHIVED tab has rows, and an archived hostel reports no active rooms —
  // so it looked exactly like an unfinished build. Owners were sent into the
  // builder on it and hit "Cannot modify rooms/floors of an archived hostel"
  // the moment they saved a floor.
  it('never offers an archived hostel, however empty it looks', () => {
    expect(findHostelInProgress([hostel({ status: 'ARCHIVED' })])).toBeNull();
  });

  // Same guard exists server-side for INACTIVE, with its own message.
  it('never offers an inactive hostel', () => {
    expect(findHostelInProgress([hostel({ status: 'INACTIVE' })])).toBeNull();
  });

  it('skips past an archived hostel to a real unfinished one', () => {
    const found = findHostelInProgress([
      hostel({ id: 'archived', status: 'ARCHIVED' }),
      hostel({ id: 'real', status: 'ACTIVE' }),
    ]);
    expect(found?.id).toBe('real');
  });

  it('is case-insensitive about status', () => {
    expect(findHostelInProgress([hostel({ status: 'active' })])?.id).toBe('h1');
  });

  // An unknown status is not proof a hostel can be written to, and being
  // wrong here means a dead end rather than a missing prompt.
  it('treats an unknown or missing status as un-buildable', () => {
    expect(findHostelInProgress([hostel({ status: 'PENDING' })])).toBeNull();
    expect(findHostelInProgress([hostel({ status: null })])).toBeNull();
    expect(findHostelInProgress([hostel({ status: undefined })])).toBeNull();
  });

  it('treats a missing capacity as no rooms', () => {
    expect(findHostelInProgress([hostel({ totalCapacity: null })])?.id).toBe('h1');
    expect(findHostelInProgress([hostel({ totalCapacity: undefined })])?.id).toBe('h1');
  });

  it('returns null for an empty or missing list rather than throwing', () => {
    expect(findHostelInProgress([])).toBeNull();
    expect(findHostelInProgress(null)).toBeNull();
    expect(findHostelInProgress(undefined)).toBeNull();
  });
});
