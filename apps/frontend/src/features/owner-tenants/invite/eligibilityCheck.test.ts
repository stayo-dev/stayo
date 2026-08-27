import { describe, expect, it } from 'vitest';
import { conflictFromPreview, type EligibilityPreview } from './eligibilityCheck';

describe('conflictFromPreview', () => {
  it('returns null when the phone is eligible, account or not', () => {
    expect(
      conflictFromPreview({ has_account: false, eligible: true, code: null, disclosure: null })
    ).toBeNull();
    expect(
      conflictFromPreview({ has_account: true, eligible: true, code: null, disclosure: null })
    ).toBeNull();
  });

  it('names the hostel when the conflict is the asking owner’s own', () => {
    const preview: EligibilityPreview = {
      has_account: true,
      eligible: false,
      code: 'TENANT_HAS_ACTIVE_TENANCY',
      disclosure: { scope: 'OWN', hostelName: 'Sunrise Residency', roomNumber: '204', tenantId: 'tenant-1' },
    };
    const conflict = conflictFromPreview(preview);
    expect(conflict?.body).toContain('Sunrise Residency, room 204');
    expect(conflict?.tenantId).toBe('tenant-1');
  });

  it('never names another owner’s hostel', () => {
    const preview: EligibilityPreview = {
      has_account: true,
      eligible: false,
      code: 'TENANT_HAS_ACTIVE_TENANCY',
      disclosure: { scope: 'OTHER', hostelName: 'Rival Residency', roomNumber: '101', tenantId: 'tenant-9' },
    };
    const conflict = conflictFromPreview(preview);
    expect(conflict?.body).not.toContain('Rival Residency');
    expect(conflict?.body).toContain('another property on Stayo');
    expect(conflict?.tenantId).toBeNull();
  });

  it('is null-safe when disclosure itself is null', () => {
    const preview: EligibilityPreview = {
      has_account: true,
      eligible: false,
      code: 'PREVIOUS_TENANCY_NOT_SETTLED',
      disclosure: null,
    };
    const conflict = conflictFromPreview(preview);
    expect(conflict?.code).toBe('PREVIOUS_TENANCY_NOT_SETTLED');
    expect(conflict?.tenantId).toBeNull();
  });
});
