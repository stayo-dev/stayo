import { describe, expect, it, vi } from 'vitest';
import { handleCoverageRequest, type CoverageHandlerDeps } from '@/src/services/discovery/coverage-request-handler';

function deps(overrides: Partial<CoverageHandlerDeps> = {}): CoverageHandlerDeps {
  return {
    checkLimit: async () => ({ allowed: true, retryAfterSeconds: 0 }),
    resolveSeekerProfileId: async () => null,
    record: async () => ({ id: 'cr1', willNotify: false }),
    ...overrides,
  };
}

describe('handleCoverageRequest', () => {
  it('records a valid request and reports whether anyone will be told', async () => {
    const record = vi.fn(async () => ({ id: 'cr1', willNotify: true }));
    const result = await handleCoverageRequest(
      { area_query: 'Osmania University', contact: '9876543210' },
      '1.2.3.4',
      deps({ record }),
    );
    expect(result.status).toBe(201);
    expect(result.body).toEqual({ recorded: true, will_notify: true });
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ areaQuery: 'Osmania University', contactPhone: '9876543210', seekerProfileId: null }),
    );
  });

  it('passes a hostel referral through with the owner contact intact', async () => {
    const record = vi.fn(async () => ({ id: 'cr2', willNotify: false }));
    const result = await handleCoverageRequest(
      { kind: 'HOSTEL', hostel_name: 'Sri Sai', owner_contact: '9876543210' },
      '1.2.3.4',
      deps({ record }),
    );
    expect(result.status).toBe(201);
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'HOSTEL', hostelName: 'Sri Sai', ownerContact: '9876543210' }),
    );
  });

  it('attaches the seeker when one is signed in', async () => {
    const record = vi.fn(async () => ({ id: 'cr1', willNotify: false }));
    await handleCoverageRequest({ area_query: 'BITS' }, '1.2.3.4', deps({
      record,
      resolveSeekerProfileId: async () => 'profile-9',
    }));
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ seekerProfileId: 'profile-9' }));
  });

  it('rate-limits before doing any work', async () => {
    const record = vi.fn(async () => ({ id: 'x', willNotify: false }));
    const result = await handleCoverageRequest({ area_query: 'BITS' }, '1.2.3.4', deps({
      checkLimit: async () => ({ allowed: false, retryAfterSeconds: 42 }),
      record,
    }));
    expect(result.status).toBe(429);
    expect(result.body).toEqual({ error: 'RATE_LIMITED', retry_after_seconds: 42 });
    expect(record).not.toHaveBeenCalled();
  });

  it('rejects a bad area with 400 and does not record', async () => {
    const record = vi.fn(async () => ({ id: 'x', willNotify: false }));
    const result = await handleCoverageRequest({ area_query: 'a' }, '1.2.3.4', deps({ record }));
    expect(result.status).toBe(400);
    expect(result.body).toEqual({ error: 'INVALID_AREA' });
    expect(record).not.toHaveBeenCalled();
  });

  it('rejects a malformed contact with 400', async () => {
    const result = await handleCoverageRequest({ area_query: 'BITS', contact: 'nope' }, '1.2.3.4', deps());
    expect(result.status).toBe(400);
    expect(result.body).toEqual({ error: 'INVALID_CONTACT' });
  });

  it('never lets a signed-in lookup failure lose the signal', async () => {
    const result = await handleCoverageRequest({ area_query: 'BITS' }, '1.2.3.4', deps({
      resolveSeekerProfileId: async () => { throw new Error('session backend down'); },
    }));
    expect(result.status).toBe(201);
  });
});
