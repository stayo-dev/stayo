import { describe, it, expect, beforeEach } from 'vitest';
import { tenantService } from '@/src/services/tenants/tenant-service';
import { createTestOwner, createTestHostel } from './factories/owner-factory';
import { createTestTenant, allocateTestRoom, createTestAgreement } from './factories/tenant-factory';
import { createTestRoom } from './factories/room-factory';

// Regression coverage for a real bug: getOwnerTenantOverview never queried the
// tenants `agreement` table at all, so the owner-facing Tenant Profile page's
// "has agreement" checks fell back to room-allocation history (or a
// `agreement_duration_months` field that was never actually present on this
// response), showing "No active agreement" / "Missing" even for tenants with
// a real SIGNED agreement — confirmed live for a tenant whose "Hostel
// Residency Agreement" document was independently verified.
describe('TenantService.getOwnerTenantOverview — agreement status', () => {
  let owner: any;
  let hostel: any;
  let tenant: any;
  let room: any;

  beforeEach(async () => {
    owner = await createTestOwner();
    hostel = await createTestHostel(owner.id);
    room = await createTestRoom(hostel.id);
    tenant = await createTestTenant(owner.id, hostel.id);
    await allocateTestRoom(tenant.id, room.id, { hostel_id: hostel.id });
  });

  it('reports has_active_agreement=true and real contract terms for a tenant with a SIGNED agreement', async () => {
    await createTestAgreement(tenant.id, hostel.id, {
      status: 'SIGNED',
      contract_rent: 8500,
      contract_security_deposit: 15000,
      agreement_duration_months: 11,
      agreement_start_date: new Date(Date.UTC(2026, 0, 1)),
    });

    const overview = await tenantService.getOwnerTenantOverview(tenant.id, owner.id);

    expect(overview.has_active_agreement).toBe(true);
    expect(overview.current_agreement).not.toBeNull();
    expect(overview.current_agreement.status).toBe('SIGNED');
    expect(Number(overview.current_agreement.contract_rent)).toBe(8500);
    expect(overview.agreement_duration_months).toBe(11);
  });

  it('reports has_active_agreement=false for a tenant with no agreement at all, even with room-allocation history', async () => {
    const overview = await tenantService.getOwnerTenantOverview(tenant.id, owner.id);

    expect(overview.has_active_agreement).toBe(false);
    expect(overview.current_agreement).toBeNull();
  });

  it('does not treat a TERMINATED (historical) agreement as current', async () => {
    await createTestAgreement(tenant.id, hostel.id, { status: 'TERMINATED' });

    const overview = await tenantService.getOwnerTenantOverview(tenant.id, owner.id);

    expect(overview.has_active_agreement).toBe(false);
  });
});
