import { describe, it, expect } from 'vitest';
import { leadStatusLabel, leadStatusToneClass, leadCanAcceptHoldReject } from './leadConstants';

describe('leadStatusLabel', () => {
  it('maps known statuses to a human label', () => {
    expect(leadStatusLabel('ON_HOLD')).toBe('On hold');
    expect(leadStatusLabel('REJECTED')).toBe('Rejected');
    expect(leadStatusLabel('ACCEPTED')).toBe('Accepted');
  });

  it('falls back to a de-slugged string for an unrecognized status', () => {
    expect(leadStatusLabel('SOME_NEW_STATUS')).toBe('SOME NEW STATUS');
  });

  it('handles a missing status', () => {
    expect(leadStatusLabel(null)).toBe('');
    expect(leadStatusLabel(undefined)).toBe('');
  });
});

describe('leadStatusToneClass', () => {
  it('gives rejected a destructive tone and accepted a success tone', () => {
    expect(leadStatusToneClass('REJECTED')).toMatch(/destructive/);
    expect(leadStatusToneClass('ACCEPTED')).toMatch(/success/);
    expect(leadStatusToneClass('ON_HOLD')).toMatch(/warning/);
  });
});

describe('leadCanAcceptHoldReject', () => {
  it('allows the action row for every open status and ON_HOLD', () => {
    for (const status of ['NEW', 'INTERESTED', 'ROOM_VISITED', 'DECISION_PENDING', 'READY_TO_JOIN', 'ON_HOLD']) {
      expect(leadCanAcceptHoldReject(status)).toBe(true);
    }
  });

  it('hides the action row for terminal/converted statuses', () => {
    for (const status of ['ACCEPTED', 'REJECTED', 'INVITED', 'JOINED', 'LOST']) {
      expect(leadCanAcceptHoldReject(status)).toBe(false);
    }
  });

  it('hides the action row when status is missing', () => {
    expect(leadCanAcceptHoldReject(null)).toBe(false);
  });
});
