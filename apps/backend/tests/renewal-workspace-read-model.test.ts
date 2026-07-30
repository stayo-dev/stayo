import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '@/lib/db';
import { createTestOwner, createTestHostel } from './factories/owner-factory';
import { createTestTenant, allocateTestRoom, createTestAgreement } from './factories/tenant-factory';
import { createTestRoom } from './factories/room-factory';
import { renewalWorkspaceReadModelService } from '@/src/services/tenants/renewal-workspace-read-model';
import { renewalTimelineService } from '@/src/services/tenants/renewal-timeline-service';

describe('RenewalWorkspaceReadModelService — composition, not reimplementation', () => {
  let owner: any;
  let hostel: any;
  let tenant: any;
  let room: any;

  beforeEach(async () => {
    owner = await createTestOwner();
    hostel = await createTestHostel(owner.id);
    room = await createTestRoom(hostel.id, { room_type: 'DOUBLE_SHARING' });
    tenant = await createTestTenant(owner.id, hostel.id);
    await allocateTestRoom(tenant.id, room.id, { hostel_id: hostel.id });
  });

  it('throws NOT_FOUND for an agreement belonging to a different owner', async () => {
    const otherOwner = await createTestOwner();
    const agreement = await createTestAgreement(tenant.id, hostel.id);

    await expect(
      renewalWorkspaceReadModelService.getWorkspace(agreement.id, otherOwner.id)
    ).rejects.toThrow('NOT_FOUND');
  });

  it('bundles agreement, tenant/room, offers, timeline, financial summary, and documents for one agreement', async () => {
    const agreement = await createTestAgreement(tenant.id, hostel.id, { contract_rent: 8100, contract_security_deposit: 16200 });

    const offer = await prisma.renewalOffer.create({
      data: {
        agreement_id: agreement.id,
        tenant_id: tenant.id,
        hostel_id: hostel.id,
        owner_id: owner.id,
        proposed_rent: 8600,
        proposed_security_deposit: 16200,
        proposed_duration_months: 11,
        proposed_start_date: new Date(Date.UTC(2026, 7, 1)),
        proposed_end_date: new Date(Date.UTC(2027, 5, 30)),
        effective_from: new Date(Date.UTC(2026, 7, 1)),
        current_rent: 8100,
        current_security_deposit: 16200,
        status: 'SENT',
      },
    });

    await renewalTimelineService.registerEvent(prisma, {
      hostelId: hostel.id,
      tenantId: tenant.id,
      agreementId: agreement.id,
      offerId: offer.id,
      eventType: 'OFFER_SENT',
      actorType: 'OWNER',
      actorId: owner.id,
    });

    const workspace = await renewalWorkspaceReadModelService.getWorkspace(agreement.id, owner.id);

    expect(workspace.agreement.id).toBe(agreement.id);
    expect(Number(workspace.agreement.contract_rent)).toBe(8100);
    expect(workspace.tenant.id).toBe(tenant.id);
    expect(workspace.tenant.room?.room_type).toBe('DOUBLE_SHARING');

    expect(workspace.offers).toHaveLength(1);
    expect(workspace.latestOffer?.id).toBe(offer.id);
    expect(Number(workspace.latestOffer?.proposed_rent)).toBe(8600);

    expect(workspace.timeline).toHaveLength(1);
    expect(workspace.timeline[0].event_type).toBe('OFFER_SENT');

    // financial summary is delegated, not recomputed — just assert it's present and shaped correctly.
    expect(typeof workspace.financial.total_due).toBe('number');

    expect(Array.isArray(workspace.documents)).toBe(true);

    // No successor draft yet — readiness is intentionally not evaluated.
    expect(workspace.successorAgreement).toBeNull();
    expect(workspace.readiness).toBeNull();
  });

  it('evaluates activation readiness once a successor draft exists, surfacing real blockers', async () => {
    const predecessor = await createTestAgreement(tenant.id, hostel.id, { status: 'SIGNED' });
    const successor = await createTestAgreement(tenant.id, hostel.id, {
      status: 'DRAFT',
      // Deliberately incomplete lifecycle metadata (no agreement_end_date) so
      // readiness surfaces a real AGREEMENT_LIFECYCLE_INCOMPLETE failure.
      agreement_end_date: null,
    });
    await prisma.agreement.update({
      where: { id: predecessor.id },
      data: { renewed_to_agreement_id: successor.id },
    });

    const workspace = await renewalWorkspaceReadModelService.getWorkspace(predecessor.id, owner.id);

    expect(workspace.successorAgreement?.id).toBe(successor.id);
    expect(workspace.readiness).not.toBeNull();
    expect(workspace.readiness?.ready).toBe(false);
    expect(workspace.readiness?.failures.some((f) => f.code === 'AGREEMENT_LIFECYCLE_INCOMPLETE')).toBe(true);
  });
});
