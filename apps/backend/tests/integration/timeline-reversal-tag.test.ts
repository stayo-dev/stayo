import { describe, it, expect } from 'vitest';
import { prisma } from '@/lib/db';
import { createTestOwner, createTestHostel } from '../factories/owner-factory';
import { createTestTenant } from '../factories/tenant-factory';
import { createTestObligation, createTestPayment } from '../factories/payment-factory';
import { reverseObligationPayment } from '@/src/services/payments/corrections/payment-correction-shared';
import { financialTimelineService } from '@/src/services/payments/financial-timeline-service';

describe('financial timeline — reversal tagging', () => {
  it('tags the reversal event as a reversal (is_reversal, negative amount, undo-language summary) on the tenant timeline', async () => {
    const owner = await createTestOwner();
    const hostel = await createTestHostel(owner.id);
    const tenant = await createTestTenant(owner.id, hostel.id);
    const obligation = await createTestObligation(tenant.id, owner.id, hostel.id, { amount: 10000 });
    const payment = await createTestPayment(obligation.id, 10000);

    await prisma.$transaction(async (tx) => {
      return reverseObligationPayment(tx, {
        hostelId: hostel.id,
        payment,
        correctionCaseId: '55555555-5555-4555-8555-555555555555',
        actorId: owner.id,
        reason: 'payment never happened',
      });
    });

    const { events } = await financialTimelineService.getTenantTimeline(tenant.id, { hostelId: hostel.id });
    const paymentEvents = events.filter((e) => e.type === 'PAYMENT_RECORDED');

    const reversal = paymentEvents.find((e) => (e.amount ?? 0) < 0);
    const original = paymentEvents.find((e) => (e.amount ?? 0) > 0);

    expect(reversal).toBeDefined();
    expect(reversal!.metadata.is_reversal).toBe(true);
    expect(reversal!.amount).toBe(-10000);
    expect(reversal!.metadata.reverses_payment_id).toBe(payment.id);
    expect(reversal!.summary).toBe('Reversal of ₹10,000 payment');

    // The original payment must NOT be tagged as a reversal, and its summary is unchanged.
    expect(original).toBeDefined();
    expect(original!.metadata.is_reversal).toBeFalsy();
    expect(original!.summary).toContain('paid via');
  });

  it('tags the reversal event on the obligation timeline too', async () => {
    const owner = await createTestOwner();
    const hostel = await createTestHostel(owner.id);
    const tenant = await createTestTenant(owner.id, hostel.id);
    const obligation = await createTestObligation(tenant.id, owner.id, hostel.id, { amount: 8000 });
    const payment = await createTestPayment(obligation.id, 8000);

    await prisma.$transaction(async (tx) => {
      return reverseObligationPayment(tx, {
        hostelId: hostel.id,
        payment,
        correctionCaseId: '66666666-6666-4666-8666-666666666666',
        actorId: owner.id,
        reason: 'payment never happened',
      });
    });

    const events = await financialTimelineService.getObligationTimeline(obligation.id);
    const reversal = events.find((e) => e.type === 'PAYMENT_RECORDED' && (e.amount ?? 0) < 0);

    expect(reversal).toBeDefined();
    expect(reversal!.metadata.is_reversal).toBe(true);
    expect(reversal!.amount).toBe(-8000);
    expect(reversal!.summary).toBe('Reversal of ₹8,000 payment');
  });
});
