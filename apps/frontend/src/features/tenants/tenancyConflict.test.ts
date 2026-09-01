import { describe, expect, it } from 'vitest';
import { buildTenancyConflictCopy, parseTenancyConflict } from './tenancyConflict';

function axiosError(code: string, details?: unknown) {
  return { response: { data: { error: { code, message: 'nope', details } } } };
}

describe('parseTenancyConflict', () => {
  it('ignores errors that are not tenancy conflicts', () => {
    expect(parseTenancyConflict(axiosError('VALIDATION_ERROR'))).toBeNull();
    expect(parseTenancyConflict(new Error('network down'))).toBeNull();
    expect(parseTenancyConflict(undefined)).toBeNull();
  });

  it('names the hostel and room when the tenant is the asking owner’s own', () => {
    const conflict = parseTenancyConflict(
      axiosError('TENANT_HAS_ACTIVE_TENANCY', {
        scope: 'OWN',
        hostelName: 'Sunrise Residency',
        roomNumber: '204',
        tenantId: 'tenant-1',
      })
    );
    expect(conflict?.body).toContain('Sunrise Residency, room 204');
    expect(conflict?.tenantId).toBe('tenant-1');
  });

  it('names the hostel without a room when no room is known', () => {
    const conflict = parseTenancyConflict(
      axiosError('TENANT_HAS_ACTIVE_TENANCY', {
        scope: 'OWN',
        hostelName: 'Sunrise Residency',
        roomNumber: null,
        tenantId: 'tenant-1',
      })
    );
    expect(conflict?.body).toContain('Sunrise Residency');
    expect(conflict?.body).not.toContain('room');
  });

  it('never names another owner’s hostel', () => {
    const conflict = parseTenancyConflict(
      axiosError('TENANT_HAS_ACTIVE_TENANCY', {
        scope: 'OTHER',
        hostelName: 'Rival Residency',
        roomNumber: '101',
        tenantId: 'tenant-9',
      })
    );
    expect(conflict?.body).not.toContain('Rival Residency');
    expect(conflict?.body).not.toContain('101');
    expect(conflict?.body).toContain('another property on Stayo');
    expect(conflict?.tenantId).toBeNull();
  });

  it('does not leak a hostel name that arrives without an OWN scope', () => {
    // Defence in depth: the backend already blanks these, but a client that
    // trusted the name over the scope would leak on any backend regression.
    const conflict = parseTenancyConflict(
      axiosError('TENANT_HAS_ACTIVE_TENANCY', {
        hostelName: 'Leaky Residency',
        roomNumber: '7',
        tenantId: 'tenant-9',
      })
    );
    expect(conflict?.body).not.toContain('Leaky Residency');
    expect(conflict?.tenantId).toBeNull();
  });

  it('explains an unsettled previous stay differently from an active one', () => {
    const conflict = parseTenancyConflict(
      axiosError('PREVIOUS_TENANCY_NOT_SETTLED', { scope: 'OTHER' })
    );
    expect(conflict?.code).toBe('PREVIOUS_TENANCY_NOT_SETTLED');
    expect(conflict?.title).toBe('Previous stay not settled');
    expect(conflict?.body).toContain('not settled');
  });

  it('tolerates a conflict with no details payload', () => {
    const conflict = parseTenancyConflict(axiosError('TENANT_HAS_ACTIVE_TENANCY'));
    expect(conflict?.title).toBe('Already a tenant');
    expect(conflict?.tenantId).toBeNull();
  });

  it('builds identical copy from a raw code+disclosure as it does from a 409 error', () => {
    // Regression guard on the extraction of buildTenancyConflictCopy: the
    // pre-submit eligibility check (a 200 response) must render the exact
    // same card as the 409 safety net does for the same underlying data.
    const disclosure = {
      scope: 'OWN' as const,
      hostelName: 'Sunrise Residency',
      roomNumber: '204',
      tenantId: 'tenant-1',
    };
    expect(buildTenancyConflictCopy('TENANT_HAS_ACTIVE_TENANCY', disclosure)).toEqual(
      parseTenancyConflict(axiosError('TENANT_HAS_ACTIVE_TENANCY', disclosure))
    );
    expect(buildTenancyConflictCopy('PREVIOUS_TENANCY_NOT_SETTLED', { scope: 'OTHER' })).toEqual(
      parseTenancyConflict(axiosError('PREVIOUS_TENANCY_NOT_SETTLED', { scope: 'OTHER' }))
    );
  });
});

/**
 * A phone number that belongs to an owner or admin account. One number is one
 * person, so it cannot also be somebody's tenant — and the refusal must say so
 * without disclosing anything about the account beyond whether it is the asking
 * owner's own.
 */
describe('buildTenancyConflictCopy — PHONE_BELONGS_TO_NON_TENANT', () => {
  it('tells an owner plainly when they have typed their own number', () => {
    const conflict = buildTenancyConflictCopy('PHONE_BELONGS_TO_NON_TENANT', { scope: 'OWN' });
    expect(conflict.title).toBe('That’s your own number');
    expect(conflict.body).toContain('your own Stayo owner account');
    expect(conflict.tenantId).toBeNull();
  });

  it('never names or links the account when it belongs to someone else', () => {
    const conflict = buildTenancyConflictCopy('PHONE_BELONGS_TO_NON_TENANT', {
      scope: 'OTHER',
      // Even if a disclosure were somehow populated, none of it may surface.
      hostelName: 'Someone Else Residency',
      roomNumber: '101',
      tenantId: 'tenant-9',
    });
    expect(conflict.body).not.toContain('Someone Else Residency');
    expect(conflict.body).not.toContain('101');
    expect(conflict.tenantId).toBeNull();
  });

  it('is recognised by parseTenancyConflict, so the submit-time 409 renders the same card', () => {
    const conflict = parseTenancyConflict({
      response: {
        data: { error: { code: 'PHONE_BELONGS_TO_NON_TENANT', details: { scope: 'OWN' } } },
      },
    });
    expect(conflict?.code).toBe('PHONE_BELONGS_TO_NON_TENANT');
    expect(conflict?.title).toBe('That’s your own number');
  });
});
