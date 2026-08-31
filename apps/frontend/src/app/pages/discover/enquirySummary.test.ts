import { describe, it, expect } from 'vitest';
import {
  moveInLabel,
  durationLabel,
  roomPreferenceLabel,
  notePreview,
  detailsLabel,
  sendAction,
} from './enquirySummary';

const TODAY = new Date(2026, 7, 30); // 30 Aug 2026, local

describe('moveInLabel', () => {
  it('says Flexible when the seeker has not chosen a date', () => {
    // The screen states answers rather than showing blanks. An untouched date
    // must not read as a form field the seeker forgot to fill in.
    expect(moveInLabel(null, TODAY)).toBe('Flexible');
    expect(moveInLabel('', TODAY)).toBe('Flexible');
    expect(moveInLabel(undefined, TODAY)).toBe('Flexible');
  });

  it('names today and tomorrow rather than printing their dates', () => {
    expect(moveInLabel('2026-08-30', TODAY)).toBe('Today');
    expect(moveInLabel('2026-08-31', TODAY)).toBe('Tomorrow');
  });

  it('writes any other date out in full', () => {
    expect(moveInLabel('2026-09-15', TODAY)).toBe('15 Sep 2026');
    expect(moveInLabel('2027-01-01', TODAY)).toBe('1 Jan 2027');
  });

  it('crosses a month and a year boundary correctly', () => {
    expect(moveInLabel('2026-09-01', new Date(2026, 7, 31))).toBe('Tomorrow');
    expect(moveInLabel('2027-01-01', new Date(2026, 11, 31))).toBe('Tomorrow');
  });

  it('falls back to Flexible on anything it cannot read', () => {
    expect(moveInLabel('not-a-date', TODAY)).toBe('Flexible');
    expect(moveInLabel('2026-13-01', TODAY)).toBe('Flexible');
  });
});

describe('durationLabel', () => {
  it('reads 12 months as a year, which is how people say it', () => {
    expect(durationLabel(12)).toBe('1 year');
  });

  it('states other durations in months', () => {
    expect(durationLabel(3)).toBe('3 months');
    expect(durationLabel(6)).toBe('6 months');
  });

  it('does not assert a duration it was never given', () => {
    expect(durationLabel(null)).toBe('Not sure yet');
    expect(durationLabel(0)).toBe('Not sure yet');
  });
});

describe('roomPreferenceLabel', () => {
  it('is null when nothing is chosen, so the row can invite instead', () => {
    expect(roomPreferenceLabel(null)).toBeNull();
    expect(roomPreferenceLabel({ floorName: null, roomNo: null })).toBeNull();
  });

  it('treats a floor with no room as a real preference, not a half-finished one', () => {
    expect(roomPreferenceLabel({ floorName: 'Ground floor', roomNo: null })).toBe('Ground floor · Any room');
  });

  it('names the room when one is picked', () => {
    expect(roomPreferenceLabel({ floorName: 'Ground floor', roomNo: '101' })).toBe('Ground floor · Room 101');
  });

  it('ignores a room with no floor — a room only means anything on its floor', () => {
    expect(roomPreferenceLabel({ floorName: null, roomNo: '101' })).toBeNull();
  });
});

describe('notePreview', () => {
  it('is null for an empty or whitespace-only note', () => {
    expect(notePreview('')).toBeNull();
    expect(notePreview('   ')).toBeNull();
    expect(notePreview(null)).toBeNull();
  });

  it('collapses newlines so a multi-line note stays one row', () => {
    expect(notePreview('I study at\n\n  BITS')).toBe('I study at BITS');
  });

  it('truncates a long note to the row width', () => {
    const preview = notePreview('a'.repeat(80), 20);
    expect(preview).toHaveLength(20);
    expect(preview?.endsWith('…')).toBe(true);
  });
});

describe('detailsLabel', () => {
  it('invites when nothing has been added', () => {
    expect(detailsLabel(null, '')).toBe('Add a room preference or a note');
  });

  it('states what was added, so the sheet need not be opened to check', () => {
    expect(detailsLabel({ floorName: 'Ground floor', roomNo: '101' }, '')).toBe('Ground floor · Room 101');
    expect(detailsLabel(null, 'I visit on Sunday')).toBe('Note: I visit on Sunday');
    expect(detailsLabel({ floorName: 'First floor', roomNo: null }, 'hi')).toBe('First floor · Any room · note added');
  });
});

describe('sendAction', () => {
  it('sends straight away for a seeker whose number is already verified', () => {
    // The whole point: one tap.
    expect(sendAction({ isSeeker: true, needsPhoneVerification: false })).toBe('submit');
  });

  it('opens phone verification at the moment it is needed, not before', () => {
    expect(sendAction({ isSeeker: true, needsPhoneVerification: true })).toBe('verify_phone');
  });

  it('asks a signed-out visitor to sign in first', () => {
    expect(sendAction({ isSeeker: false, needsPhoneVerification: false })).toBe('sign_in');
    expect(sendAction({ isSeeker: false, needsPhoneVerification: true })).toBe('sign_in');
  });
});
