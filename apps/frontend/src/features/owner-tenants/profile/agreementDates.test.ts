import { describe, expect, it } from 'vitest';
import { formatAgreementDay, toDateInputValue } from './agreementDates';

describe('toDateInputValue', () => {
  it('drops the UTC-midnight time part', () => {
    expect(toDateInputValue('2026-08-01T00:00:00.000Z')).toBe('2026-08-01');
  });
  it('passes a plain day through', () => {
    expect(toDateInputValue('2026-08-01')).toBe('2026-08-01');
  });
  it('is null for empty or garbage input', () => {
    expect(toDateInputValue(null)).toBeNull();
    expect(toDateInputValue('')).toBeNull();
    expect(toDateInputValue('not a date')).toBeNull();
  });
});

describe('formatAgreementDay', () => {
  it('reads an ISO timestamp as the calendar day it names', () => {
    expect(formatAgreementDay('2026-08-01T00:00:00.000Z')).toBe('01 Aug 2026');
    expect(formatAgreementDay('2027-08-01T00:00:00.000Z')).toBe('01 Aug 2027');
  });
  it('does not shift a day stored just before midnight UTC', () => {
    expect(formatAgreementDay('2026-12-31T23:59:59.000Z')).toBe('31 Dec 2026');
  });
  it('shows a dash when there is nothing to show', () => {
    expect(formatAgreementDay(null)).toBe('—');
    expect(formatAgreementDay('nope')).toBe('—');
  });
});
