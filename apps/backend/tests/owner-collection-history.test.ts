import { describe, it, expect } from 'vitest';
import { prisma } from '@/lib/db';
import { ownerCollectionHistory } from '@/lib/services/owner-collection-history';
import { createTestOwner, createTestHostel } from './factories/owner-factory';
import { createTestTenant } from './factories/tenant-factory';
import { createTestObligation, createTestPayment } from './factories/payment-factory';

/**
 * The lifetime "has money ever come in" fact behind Home's getting-started
 * checklist. It replaced *this month's* collection, which reset on the 1st and
 * therefore forced a one-way latch in browser storage — a latch that was keyed
 * globally rather than per owner and ended up hiding the checklist, and with
 * it the only route into hostel creation, from brand-new accounts. See
 * ADR-139.
 *
 * What matters here is that the answer is scoped to the right owner and does
 * not decay with time, so the two cases below are: somebody else's payment
 * must not count, and last year's payment must still count.
 */
describe('ownerCollectionHistory.hasEverCollected', () => {
  async function ownerWithHostel() {
    const owner = await createTestOwner();
    const hostel = await createTestHostel(owner.id);
    return { owner, hostel };
  }

  it('is false for an owner who has never taken a payment', async () => {
    const { owner } = await ownerWithHostel();
    expect(await ownerCollectionHistory.hasEverCollected(owner.id)).toBe(false);
  });

  it('is true once a payment exists', async () => {
    const { owner, hostel } = await ownerWithHostel();
    const tenant = await createTestTenant(owner.id, hostel.id);
    const obligation = await createTestObligation(tenant.id, owner.id, hostel.id);
    await createTestPayment(obligation.id, 10000);

    expect(await ownerCollectionHistory.hasEverCollected(owner.id)).toBe(true);
  });

  it('stays true for a payment taken long ago, in another month', async () => {
    // The whole point of the change: a quiet month must not reset this.
    const { owner, hostel } = await ownerWithHostel();
    const tenant = await createTestTenant(owner.id, hostel.id);
    const obligation = await createTestObligation(tenant.id, owner.id, hostel.id);
    await createTestPayment(obligation.id, 10000, {
      payment_date: new Date('2024-02-14T00:00:00.000Z'),
    });

    expect(await ownerCollectionHistory.hasEverCollected(owner.id)).toBe(true);
  });

  it('never counts another owner’s payment', async () => {
    const mine = await ownerWithHostel();
    const theirs = await ownerWithHostel();
    const tenant = await createTestTenant(theirs.owner.id, theirs.hostel.id);
    const obligation = await createTestObligation(tenant.id, theirs.owner.id, theirs.hostel.id);
    await createTestPayment(obligation.id, 10000);

    expect(await ownerCollectionHistory.hasEverCollected(mine.owner.id)).toBe(false);
    expect(await ownerCollectionHistory.hasEverCollected(theirs.owner.id)).toBe(true);
  });

  it('counts a payment whose nullable owner_id was never written', async () => {
    // `payments.owner_id` is nullable, which is why this is scoped through the
    // `hostels` relation instead. Filtering on `owner_id` would report "never
    // collected" for a real payment and put a finished owner back on step one.
    const { owner, hostel } = await ownerWithHostel();
    const tenant = await createTestTenant(owner.id, hostel.id);
    const obligation = await createTestObligation(tenant.id, owner.id, hostel.id);
    const payment = await createTestPayment(obligation.id, 10000);
    await prisma.payments.update({ where: { id: payment.id }, data: { owner_id: null } });

    expect(await ownerCollectionHistory.hasEverCollected(owner.id)).toBe(true);
  });
});
