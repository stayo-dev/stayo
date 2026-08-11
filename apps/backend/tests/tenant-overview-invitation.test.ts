import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '@/lib/db';
import { tenantService } from '@/src/services/tenants/tenant-service';
import { createTestOwner, createTestHostel } from './factories/owner-factory';
import { createTestTenant } from './factories/tenant-factory';
import { createTestRoom } from './factories/room-factory';

/**
 * Regression coverage for the owner-side pre-activation workspace.
 *
 * Two facts about INVITED tenants made that screen show fiction:
 *
 *  1. The overview response carried no `hostel_id`, so every hostel-scoped
 *     editor the owner opened from it (room list, pricing defaults) received
 *     an empty hostel id, disabled its own prefill query, and rendered a
 *     blank form — while the screen showed the hostel as "—".
 *  2. A room is mandatory at invite time but `room_allocations` is only
 *     written at activation, so reading the room from allocations made every
 *     invited tenant look room-less. The bed is really held by
 *     `tenant_invitation_reservations`.
 *
 * The `invitation` block exists so owner screens read one normalized shape
 * instead of re-deriving these from raw invitation rows — and so the
 * activation token never has to reach the client.
 */
describe('TenantService.getOwnerTenantOverview — invitation summary', () => {
  let owner: any;
  let hostel: any;
  let room: any;
  let tenant: any;

  const futureDate = (days: number) => new Date(Date.now() + days * 86_400_000);

  async function createInvitation(overrides: Record<string, any> = {}) {
    return prisma.tenant_invitations.create({
      data: {
        tenant_id: tenant.id,
        owner_id: owner.id,
        hostel_id: hostel.id,
        room_id: room.id,
        name: 'Invited Tenant',
        phone: '9876543210',
        token: `tok-${Math.random().toString(36).slice(2)}`,
        expires_at: futureDate(7),
        status: 'PENDING',
        agreement_duration_months: 11,
        ...overrides,
      },
    });
  }

  beforeEach(async () => {
    owner = await createTestOwner();
    hostel = await createTestHostel(owner.id);
    room = await createTestRoom(hostel.id);
    tenant = await createTestTenant(owner.id, hostel.id, { status: 'INVITED' });
  });

  it('returns the hostel id an owner editor needs to scope itself', async () => {
    await createInvitation();

    const overview = await tenantService.getOwnerTenantOverview(tenant.id, owner.id);

    expect(overview.hostel_id).toBe(hostel.id);
  });

  it('reports the reserved room for a tenant who has no allocation yet', async () => {
    await createInvitation();

    const overview = await tenantService.getOwnerTenantOverview(tenant.id, owner.id);

    expect(overview.current_room).toBeNull();
    expect(overview.invitation?.reserved_room).toMatchObject({ id: room.id, room_no: room.room_no });
  });

  it('exposes the delivery funnel the invitation already tracks', async () => {
    const openedAt = new Date(Date.now() - 86_400_000);
    await createInvitation({ status: 'OPENED', opened_at: openedAt });

    const overview = await tenantService.getOwnerTenantOverview(tenant.id, owner.id);

    expect(overview.invitation?.status).toBe('OPENED');
    expect(overview.invitation?.opened_at?.toISOString()).toBe(openedAt.toISOString());
    expect(overview.invitation?.expires_at).toBeInstanceOf(Date);
  });

  it('shares an activation link but never the raw token', async () => {
    const invitation = await createInvitation();

    const overview = await tenantService.getOwnerTenantOverview(tenant.id, owner.id);

    expect(overview.invitation?.activation_link).toContain(`/activate/${invitation.token}`);
    expect(overview.invitation).not.toHaveProperty('token');
  });

  it('prefers the live invitation over a superseded one', async () => {
    await createInvitation({ status: 'CANCELLED', cancelled_at: new Date() });
    const live = await createInvitation({ status: 'PENDING' });

    const overview = await tenantService.getOwnerTenantOverview(tenant.id, owner.id);

    expect(overview.invitation?.id).toBe(live.id);
    expect(overview.invitation?.revision).toBe(2);
  });

  it('omits the invitation block for a tenant who was never invited', async () => {
    const activeTenant = await createTestTenant(owner.id, hostel.id, { status: 'ACTIVE' });

    const overview = await tenantService.getOwnerTenantOverview(activeTenant.id, owner.id);

    expect(overview.invitation).toBeNull();
  });
});
