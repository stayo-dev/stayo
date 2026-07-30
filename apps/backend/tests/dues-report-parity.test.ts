import { describe, it, expect, beforeEach } from 'vitest';
import { createTestOwner, createTestHostel } from './factories/owner-factory';
import { createTestTenant, allocateTestRoom } from './factories/tenant-factory';
import { createTestRoom } from './factories/room-factory';
import { createTestObligation, createTestPayment } from './factories/payment-factory';
import { financialService } from '@/src/services/payments/financial-service';
import { paymentService } from '@/src/services/payments/payment-service';

/**
 * paymentService.getDuesReport() (owner-wide dues table, GET /api/payments/dues)
 * already uses the correct `total_amount || amount` formula — this is not a
 * bug, just a duplicated implementation of the same "outstanding" concept
 * getTenantDues() computes. This test proves the two stay numerically
 * identical for the same obligation rather than rewriting getDuesReport()
 * (which returns a flat multi-tenant array and can't literally delegate to
 * the single-tenant FinancialReadModel without introducing N+1 queries).
 */
describe('getDuesReport() numeric parity with getTenantDues()', () => {
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

  it('reports the same outstanding amount for a partially-paid obligation with a late fee', async () => {
    const obligation = await createTestObligation(tenant.id, owner.id, hostel.id, {
      amount: 8000, total_amount: 8500, late_fee: 500, status: 'PARTIAL',
    });
    await createTestPayment(obligation.id, 2000);

    const [dues, report] = await Promise.all([
      financialService.getTenantDues(tenant.id, owner.id, hostel.id),
      paymentService.getDuesReport(owner.id, hostel.id),
    ]);

    const duesItem = dues.items.find((i) => i.obligation_id === obligation.id);
    const reportItem = report.find((r: any) => r.obligation_id === obligation.id);

    expect(duesItem).toBeDefined();
    expect(reportItem).toBeDefined();
    expect(reportItem!.outstanding).toBe(duesItem!.outstanding);
    expect(reportItem!.outstanding).toBe(6500);
  });
});
