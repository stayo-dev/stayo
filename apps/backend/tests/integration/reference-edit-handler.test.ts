import { describe, it, expect } from 'vitest';
import { prisma } from '@/lib/db';
import { createTestOwner, createTestHostel } from '../factories/owner-factory';
import { createTestTenant } from '../factories/tenant-factory';
import { recoveryService } from '@/src/services/recovery/recovery-service';
import { correctionRegistry } from '@/src/services/recovery/correction-registry';
import '@/src/services/payments/corrections/reference-edit-handler'; // registers itself

describe('referenceEditHandler (end to end via recoveryService)', () => {
  it('updates payment_groups.reference_number and notes, and records the edit as an audited case', async () => {
    const owner = await createTestOwner();
    const hostel = await createTestHostel(owner.id);
    const tenant = await createTestTenant(owner.id, hostel.id);

    const group = await prisma.payment_groups.create({
      data: {
        tenant_id: tenant.id, owner_id: owner.id, hostel_id: hostel.id,
        total_amount: 5000, method: 'UPI', reference_number: 'OLD-REF-123',
      },
    });

    expect(correctionRegistry.has('PAYMENT_REFERENCE_EDIT')).toBe(true);

    const kase = await recoveryService.createCase('PAYMENT_REFERENCE_EDIT', {
      hostelId: hostel.id,
      actor: { actorId: owner.id, actorRole: 'OWNER' },
      reason: 'owner typo\'d the UTR',
      input: { paymentGroupId: group.id, referenceNumber: 'NEW-REF-456', notes: 'corrected UTR' },
    });

    await recoveryService.preview(kase.id);
    await recoveryService.validate(kase.id);
    const executed = await recoveryService.execute(kase.id, { actorId: owner.id, actorRole: 'OWNER' });
    expect(executed.status).toBe('COMPLETED');

    const updated = await prisma.payment_groups.findUniqueOrThrow({ where: { id: group.id } });
    expect(updated.reference_number).toBe('NEW-REF-456');
    expect(updated.notes).toBe('corrected UTR');

    const events = await prisma.correction_case_events.findMany({ where: { correction_case_id: kase.id } });
    expect(events.map((e) => e.event_type)).toEqual(
      expect.arrayContaining(['CREATED', 'PREVIEWED', 'VALIDATED', 'EXECUTION_STARTED', 'EXECUTION_SUCCEEDED'])
    );
  });

  it('createCase throws when the payment group does not belong to the claimed hostel', async () => {
    const owner = await createTestOwner();
    const hostelA = await createTestHostel(owner.id);
    const hostelB = await createTestHostel(owner.id);
    const tenantA = await createTestTenant(owner.id, hostelA.id);

    const group = await prisma.payment_groups.create({
      data: {
        tenant_id: tenantA.id, owner_id: owner.id, hostel_id: hostelA.id,
        total_amount: 5000, method: 'UPI', reference_number: 'OLD-REF-123',
      },
    });

    // Case is created claiming hostelB, but the payment group actually belongs to hostelA.
    await expect(
      recoveryService.createCase('PAYMENT_REFERENCE_EDIT', {
        hostelId: hostelB.id,
        actor: { actorId: owner.id, actorRole: 'OWNER' },
        reason: 'wrong hostel claimed for payment group',
        input: { paymentGroupId: group.id, referenceNumber: 'NEW-REF-456' },
      })
    ).rejects.toThrow(/hostel/i);
  });
});
