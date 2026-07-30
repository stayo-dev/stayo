import { describe, it, expect, beforeEach } from 'vitest';
import { createTestOwner, createTestHostel } from '../factories/owner-factory';
import { createTestTenant, allocateTestRoom } from '../factories/tenant-factory';
import { createTestRoom } from '../factories/room-factory';
import { createTestObligation } from '../factories/payment-factory';
import { financialService } from '@/src/services/payments/financial-service';

const daysFromNow = (days: number) => {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
};

describe('FinancialService.getTenantDues — overdue vs upcoming (bug 1 reproduction)', () => {
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

  it('only counts the already-due obligation as overdue — not the full multi-month balance', async () => {
    // Only the currently-active obligation is actually overdue (due 30 days
    // ago). The other two are UPCOMING, mirroring an agreement schedule
    // generated upfront where only the current month has become payable.
    await createTestObligation(tenant.id, owner.id, hostel.id, {
      amount: 8000, total_amount: 8000, status: 'PENDING',
      due_date: daysFromNow(-30), rent_month: daysFromNow(-30),
    });
    await createTestObligation(tenant.id, owner.id, hostel.id, {
      amount: 8000, total_amount: 8000, status: 'UPCOMING',
      due_date: daysFromNow(30), rent_month: daysFromNow(30),
    });
    await createTestObligation(tenant.id, owner.id, hostel.id, {
      amount: 8000, total_amount: 8000, status: 'UPCOMING',
      due_date: daysFromNow(60), rent_month: daysFromNow(60),
    });

    const dues = await financialService.getTenantDues(tenant.id, owner.id, hostel.id);

    expect(dues.total_due).toBe(24000);
    // The bug: this used to be conflated with total_due (24000). Only the
    // one genuinely-overdue obligation should count here.
    expect(dues.overdue_amount).toBe(8000);
    expect(dues.current_payable_amount).toBe(8000);
    expect(dues.upcoming_amount).toBe(16000);
  });

  it('treats a PENDING obligation due today as not-yet-overdue but still current-payable', async () => {
    await createTestObligation(tenant.id, owner.id, hostel.id, {
      amount: 8000, total_amount: 8000, status: 'PENDING',
      due_date: daysFromNow(0), rent_month: daysFromNow(0),
    });

    const dues = await financialService.getTenantDues(tenant.id, owner.id, hostel.id);

    expect(dues.overdue_amount).toBe(0);
    expect(dues.current_payable_amount).toBe(8000);
    expect(dues.upcoming_amount).toBe(0);
  });

  it('excludes fully-paid obligations from every metric', async () => {
    const obligation = await createTestObligation(tenant.id, owner.id, hostel.id, {
      amount: 8000, total_amount: 8000, status: 'PAID',
      due_date: daysFromNow(-10), rent_month: daysFromNow(-10),
    });

    const dues = await financialService.getTenantDues(tenant.id, owner.id, hostel.id);

    expect(dues.total_due).toBe(0);
    expect(dues.overdue_amount).toBe(0);
    expect(dues.current_payable_amount).toBe(0);
    expect(dues.upcoming_amount).toBe(0);
    void obligation;
  });
});
