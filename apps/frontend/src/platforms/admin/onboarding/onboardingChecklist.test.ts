import { describe, expect, it } from 'vitest';
import { computeOnboardingChecklist } from './onboardingChecklist';

const COMPLETE = {
  verification_status: 'VERIFIED',
  listing_status: 'LIVE',
  rooms: 4,
  capacity: 12,
  tenants: 8,
  revenue: 50000,
  subscription_status: 'ACTIVE',
};

describe('computeOnboardingChecklist', () => {
  it('marks every item done and status complete when every signal is real', () => {
    const result = computeOnboardingChecklist(COMPLETE);
    expect(result.completed).toBe(result.total);
    expect(result.status).toBe('complete');
    expect(result.items.every((i) => i.done)).toBe(true);
  });

  it('marks status in_progress when any signal is missing', () => {
    const result = computeOnboardingChecklist({ ...COMPLETE, tenants: 0 });
    expect(result.status).toBe('in_progress');
    expect(result.items.find((i) => i.id === 'tenant')?.done).toBe(false);
  });

  it('a brand-new hostel with no data completes nothing', () => {
    const result = computeOnboardingChecklist({
      verification_status: null,
      listing_status: null,
      rooms: 0,
      capacity: 0,
      tenants: 0,
      revenue: 0,
      subscription_status: null,
    });
    expect(result.completed).toBe(0);
    expect(result.status).toBe('in_progress');
  });
});
