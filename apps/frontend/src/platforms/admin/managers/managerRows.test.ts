import { describe, expect, it } from 'vitest';
import { toManagerRows, managerStats } from './managerRows';

const RAW_MANAGER = {
  id: 'm1',
  profile_id: 'p1',
  status: 'ACTIVE',
  profile: { id: 'p1', name: 'Rahul Kumar', email: 'rahul@example.com', phone: '9999999999' },
  permissions: [{ permission: 'MANAGE_HOSTELS' }, { permission: 'MANAGE_ONBOARDING' }],
  hostel_assignments: [{ id: 'a1', hostel_id: 'h1' }, { id: 'a2', hostel_id: 'h2' }],
};

describe('toManagerRows', () => {
  it('shapes a manager into a table row', () => {
    const [row] = toManagerRows([RAW_MANAGER]);
    expect(row.name).toBe('Rahul Kumar');
    expect(row.status).toBe('ACTIVE');
    expect(row.permissions).toEqual(['MANAGE_HOSTELS', 'MANAGE_ONBOARDING']);
    expect(row.hostelCount).toBe(2);
    expect(row.hostelIds).toEqual(['h1', 'h2']);
    expect(row.initials).toBe('RK');
  });

  it('defaults to PENDING_INVITATION when status is missing', () => {
    const [row] = toManagerRows([{ ...RAW_MANAGER, status: undefined }]);
    expect(row.status).toBe('PENDING_INVITATION');
  });

  it('handles an empty list', () => {
    expect(toManagerRows([])).toEqual([]);
    expect(toManagerRows(undefined as any)).toEqual([]);
  });
});

describe('managerStats', () => {
  it('counts active, pending and total assigned hostels', () => {
    const rows = toManagerRows([
      RAW_MANAGER,
      { ...RAW_MANAGER, id: 'm2', status: 'PENDING_INVITATION', hostel_assignments: [] },
    ]);
    const stats = managerStats(rows);
    expect(stats.find((s) => s.label === 'Total managers')?.value).toBe('2');
    expect(stats.find((s) => s.label === 'Active')?.value).toBe('1');
    expect(stats.find((s) => s.label === 'Pending invitation')?.value).toBe('1');
    expect(stats.find((s) => s.label === 'Hostels assigned')?.value).toBe('2');
  });
});
