import { describe, it, expect, beforeEach } from 'vitest';
import { createTestOwner, createTestHostel } from './factories/owner-factory';
import { createTestTenant, allocateTestRoom } from './factories/tenant-factory';
import { createTestRoom } from './factories/room-factory';
import { createTestObligation, createTestPayment } from './factories/payment-factory';
import { financialService } from '@/src/services/payments/financial-service';

/**
 * Direct service-call test for FinancialService.getTenantFinancialStatus() —
 * replaces the deleted tests/financial-status-api.test.ts, which tested this
 * through the now-removed GET /api/payments/financial-status route (zero
 * frontend/API consumers, deleted per docs/business-logic/
 * financial-consistency-investigation-report.md). The service method itself
 * survives: lib/services/notifications/whatsapp-webhook-event-service.ts
 * calls it directly for WhatsApp DUES/PAY commands.
 */
describe('FinancialService.getTenantFinancialStatus — payable_now delegates to getTenantDues()', () => {
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

  it('returns correct payable_now and fully_settled for a partially-paid obligation', async () => {
    // 15000 total, 5000 paid -> 10000 outstanding (payable_now)
    const obligation = await createTestObligation(tenant.id, owner.id, hostel.id, {
      amount: 15000, total_amount: 15000,
    });
    await createTestPayment(obligation.id, 5000);

    const status = await financialService.getTenantFinancialStatus(tenant.id);

    expect(status.payable_now).toBe(10000);
    expect(status.fully_settled).toBe(false);
  });

  it('agrees with getTenantDues().current_payable_amount for the same tenant', async () => {
    await createTestObligation(tenant.id, owner.id, hostel.id, {
      amount: 8000, total_amount: 8000, status: 'PARTIAL',
    });

    const [status, dues] = await Promise.all([
      financialService.getTenantFinancialStatus(tenant.id),
      financialService.getTenantDues(tenant.id, owner.id, hostel.id),
    ]);

    expect(status.payable_now).toBe(dues.current_payable_amount);
  });

  it('fully_settled is true with no outstanding obligations and no contract value', async () => {
    const status = await financialService.getTenantFinancialStatus(tenant.id);
    expect(status.payable_now).toBe(0);
    expect(status.fully_settled).toBe(true);
  });
});
