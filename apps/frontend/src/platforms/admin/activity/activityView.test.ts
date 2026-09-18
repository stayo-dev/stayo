import { describe, expect, it } from 'vitest';
import { describeAction, describeChangedFields, cleanActivityFilters } from './activityView';

describe('describeAction', () => {
  it('maps known action types to admin-facing copy', () => {
    expect(describeAction('HOSTEL_UPDATED')).toBe('Updated hostel details');
    expect(describeAction('HOSTEL_REASSIGNED')).toBe('Reassigned hostel');
  });

  it('falls back to a readable label for an unknown action type', () => {
    expect(describeAction('SOME_NEW_ACTION')).toBe('Some new action');
  });
});

describe('describeChangedFields', () => {
  it('formats one line per changed field', () => {
    const lines = describeChangedFields([{ field: 'monthly_rent', from: 6500, to: 7000 }]);
    expect(lines).toEqual(['monthly_rent: 6500 → 7000']);
  });

  it('renders a missing value as an em dash, not blank', () => {
    const lines = describeChangedFields([{ field: 'city', from: null, to: 'Hyderabad' }]);
    expect(lines).toEqual(['city: — → Hyderabad']);
  });

  it('returns an empty array for no diff', () => {
    expect(describeChangedFields(undefined)).toEqual([]);
    expect(describeChangedFields([])).toEqual([]);
  });
});

describe('cleanActivityFilters', () => {
  it('drops empty-string values', () => {
    expect(cleanActivityFilters({ managerId: 'm1', hostelId: '' })).toEqual({ managerId: 'm1' });
  });
});
