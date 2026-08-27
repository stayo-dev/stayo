import { describe, expect, it } from 'vitest';
import { classifyHostelRelationship } from './hostelRelationship';
import type { DisclosedHistory } from './api/tenantHistory';
import type { ResidencyStay } from '@features/profile/api';

const HOSTEL_A = 'hostel-a';
const HOSTEL_B = 'hostel-b';

const stay = (overrides: Partial<ResidencyStay> = {}): ResidencyStay => ({
  id: overrides.id ?? 'stay-1',
  hostel: overrides.hostel ?? { id: HOSTEL_A, name: 'Hostel A', city: 'Bangalore' },
  joined_on: '2026-01-01',
  exit_date: '2026-06-01',
  is_current: false,
  duration_months: 5,
  room_no: 'B-204',
  sharing: 4,
  room_type: 'SHARED',
  monthly_rent: 8000,
  settled: true,
  ever_moved_in: true,
  ...overrides,
});

const history = (overrides: Partial<DisclosedHistory> = {}): DisclosedHistory => ({
  allowed: true,
  reason: 'TENANCY',
  stays: [],
  total_stays: 0,
  total_months: 0,
  ...overrides,
});

describe('classifyHostelRelationship', () => {
  it('returns UNKNOWN when access is refused, even with stays present', () => {
    const result = classifyHostelRelationship(
      history({ allowed: false, reason: 'NOT_ENGAGED', stays: [stay()] }),
      HOSTEL_A,
    );
    expect(result).toEqual({ relationship: 'UNKNOWN', stay: null });
  });

  it('returns NEW when allowed but there are no stays at all', () => {
    const result = classifyHostelRelationship(history({ stays: [] }), HOSTEL_A);
    expect(result).toEqual({ relationship: 'NEW', stay: null });
  });

  it('returns NEW when stays exist but none match this hostel and none are live', () => {
    const result = classifyHostelRelationship(
      history({ stays: [stay({ hostel: { id: HOSTEL_B, name: 'Hostel B', city: 'Pune' }, is_current: false })] }),
      HOSTEL_A,
    );
    expect(result).toEqual({ relationship: 'NEW', stay: null });
  });

  it('returns PREVIOUS_TENANT for a non-current stay at this hostel', () => {
    const pastStay = stay({ is_current: false });
    const result = classifyHostelRelationship(history({ stays: [pastStay] }), HOSTEL_A);
    expect(result).toEqual({ relationship: 'PREVIOUS_TENANT', stay: pastStay });
  });

  it('returns CURRENT_TENANT for a live stay at this hostel', () => {
    const liveStay = stay({ is_current: true, exit_date: null });
    const result = classifyHostelRelationship(history({ stays: [liveStay] }), HOSTEL_A);
    expect(result).toEqual({ relationship: 'CURRENT_TENANT', stay: liveStay });
  });

  it('picks the most recent (first) match when multiple past stays exist at this hostel', () => {
    const older = stay({ id: 'stay-old' });
    const newer = stay({ id: 'stay-new' });
    const result = classifyHostelRelationship(history({ stays: [newer, older] }), HOSTEL_A);
    expect(result.relationship).toBe('PREVIOUS_TENANT');
    expect(result.stay?.id).toBe('stay-new');
  });

  it('prioritises a current stay over past ones at the same hostel', () => {
    const past = stay({ id: 'stay-past', is_current: false });
    const live = stay({ id: 'stay-live', is_current: true, exit_date: null });
    const result = classifyHostelRelationship(history({ stays: [past, live] }), HOSTEL_A);
    expect(result).toEqual({ relationship: 'CURRENT_TENANT', stay: live });
  });

  // ACTIVE_ELSEWHERE — added for the invite/Leads-blocking feature (ADR-125):
  // a live stay at a DIFFERENT hostel is what actually blocks an invite here,
  // which the original NEW/CURRENT_TENANT/PREVIOUS_TENANT/UNKNOWN set had no
  // way to express.
  it('returns ACTIVE_ELSEWHERE for a live stay at a different hostel', () => {
    const elsewhere = stay({
      hostel: { id: HOSTEL_B, name: 'Hostel B', city: 'Pune' },
      is_current: true,
      exit_date: null,
    });
    const result = classifyHostelRelationship(history({ stays: [elsewhere] }), HOSTEL_A);
    expect(result).toEqual({ relationship: 'ACTIVE_ELSEWHERE', stay: elsewhere });
  });

  it('prefers CURRENT_TENANT over ACTIVE_ELSEWHERE when both exist (the partial-unique-index guarantees only one live tenancy anyway, but the classifier should not depend on that)', () => {
    const here = stay({ id: 'stay-here', hostel: { id: HOSTEL_A, name: 'Hostel A', city: 'Bangalore' }, is_current: true, exit_date: null });
    const elsewhere = stay({ id: 'stay-elsewhere', hostel: { id: HOSTEL_B, name: 'Hostel B', city: 'Pune' }, is_current: false });
    const result = classifyHostelRelationship(history({ stays: [here, elsewhere] }), HOSTEL_A);
    expect(result).toEqual({ relationship: 'CURRENT_TENANT', stay: here });
  });
});
