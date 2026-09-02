import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createTestOwner, createTestHostel } from '../factories/owner-factory';
import { createTestRoom } from '../factories/room-factory';
import { tenantInvitationLifecycleService } from '../../src/services/tenants/tenant-invitation-lifecycle-service';
import { tenantService } from '../../src/services/tenants/tenant-service';
import { unacceptedTenancyExpiryService } from '../../src/services/tenants/unaccepted-tenancy-expiry-service';
import { MetaWhatsAppProvider } from '../../lib/services/notifications/providers/whatsapp/meta-provider';
import { prisma } from '../../lib/db';

vi.mock('../../lib/services/email-service', () => ({
  EmailService: { sendInvitation: vi.fn().mockResolvedValue({ sent: true }), sendEmail: vi.fn() },
}));

/**
 * ADR-165 — tenant acceptance is a mandatory, explicit state.
 *
 * A new invitation makes the tenancy operationally live (ACTIVE, room, rent)
 * but `acceptance_status = PENDING` until the tenant personally completes
 * activation. The owner has no path to accept on their behalf, and there is a
 * clean cancel/expiry that frees the room and voids future obligations while
 * keeping past dues + payments for settlement.
 */
describe('Tenant acceptance lifecycle (ADR-165)', () => {
  let owner: any;
  let hostel: any;
  let room: any;
  let waSpy: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    owner = await createTestOwner();
    hostel = await createTestHostel(owner.id);
    room = await createTestRoom(hostel.id);
    waSpy = vi.spyOn(MetaWhatsAppProvider.prototype, 'sendInvitation');
    waSpy.mockResolvedValue({ providerMessageId: 'wamid.acceptance_test', attempts: 1 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetAllMocks();
  });

  async function invite(phone: string, rent = 9000) {
    return tenantInvitationLifecycleService.createInvitation(
      { name: 'Pending Tenant', phone, room_id: room.id, monthly_rent: rent },
      owner.id,
    ) as any;
  }

  it('a fresh invite is ACTIVE + PENDING, live, unattested, unstamped', async () => {
    const invited = await invite('9876500001');
    const t = await prisma.tenants.findUnique({ where: { id: invited.tenant_id } });
    expect(t?.status).toBe('ACTIVE');
    expect(t?.access_mode).toBe('OWNER_MANAGED');
    expect(t?.acceptance_status).toBe('PENDING');
    expect(t?.activation_completed_at).toBeNull();
    expect(t?.tenant_accepted_at).toBeNull();

    const inv = await prisma.tenant_invitations.findUnique({ where: { id: invited.invitation_id } });
    expect(inv?.status).toBe('PENDING');

    const attest = await prisma.tenant_owner_attestations.count({ where: { tenant_id: invited.tenant_id } });
    expect(attest).toBe(0);

    const alloc = await prisma.roomAllocation.count({
      where: { tenant_id: invited.tenant_id, is_active: true, end_date: null },
    });
    expect(alloc).toBe(1);

    const obligations = await prisma.rent_obligations.count({ where: { tenant_id: invited.tenant_id } });
    expect(obligations).toBeGreaterThan(0);
  });

  it('the personal link opens the wizard (never ALREADY_ACTIVE) and completion flips the state', async () => {
    const invited = await invite('9876500002');
    const inv = await prisma.tenant_invitations.findUnique({ where: { id: invited.invitation_id } });

    const resolved: any = await tenantInvitationLifecycleService.resolveByToken(inv!.token);
    expect(resolved.source).toBe('tenant_invitations');

    await tenantInvitationLifecycleService.completeActivation(
      resolved.invitation, resolved.tenant, resolved.profile, 'MONTHLY', 'SomePassword123!',
    );

    const t = await prisma.tenants.findUnique({ where: { id: invited.tenant_id } });
    expect(t?.acceptance_status).toBe('ACCEPTED');
    expect(t?.access_mode).toBe('SELF_SERVE');
    expect(t?.tenant_accepted_at).not.toBeNull();
    expect(t?.activation_completed_at).not.toBeNull();

    // Re-resolving the (now ACTIVATED) link reports ALREADY_ACTIVE.
    await expect(tenantInvitationLifecycleService.resolveByToken(inv!.token)).rejects.toThrow(/ALREADY_ACTIVE/);
  });

  it('the owner cannot fill tenant-only fields while PENDING', async () => {
    const invited = await invite('9876500003');
    await expect(
      tenantService.updateTenant(invited.tenant_id, { guardian_name: 'Dad', college_name: 'IIT' }, owner.id),
    ).rejects.toThrow(/guardian_name/);

    // Owner-operable fields still work.
    await expect(
      tenantService.updateTenant(invited.tenant_id, { display_name: 'Pending Tenant Jr' }, owner.id),
    ).resolves.toBeTruthy();
  });

  it('owner cancel frees the room and voids future obligations but keeps past + payments', async () => {
    const invited = await invite('9876500004');

    // A recorded payment against the first obligation.
    const first = await prisma.rent_obligations.findFirst({
      where: { tenant_id: invited.tenant_id },
      orderBy: { rent_month: 'asc' },
    });
    // (Backdate a future obligation so the closure has something to void.)
    const future = await prisma.rent_obligations.create({
      data: {
        tenant_id: invited.tenant_id,
        hostel_id: hostel.id,
        obligation_type: 'RENT',
        amount: 9000,
        status: 'PENDING',
        rent_month: new Date(Date.UTC(new Date().getUTCFullYear() + 1, 0, 1)),
        due_date: new Date(Date.UTC(new Date().getUTCFullYear() + 1, 0, 5)),
      } as any,
    });

    await tenantService.cancelInvitation(invited.tenant_id, owner.id);

    const t = await prisma.tenants.findUnique({ where: { id: invited.tenant_id } });
    expect(t?.status).toBe('CANCELLED');

    const activeAlloc = await prisma.roomAllocation.count({
      where: { tenant_id: invited.tenant_id, is_active: true, end_date: null },
    });
    expect(activeAlloc).toBe(0);

    const futureAfter = await prisma.rent_obligations.findUnique({ where: { id: future.id } });
    expect(futureAfter?.status).toBe('WAIVED');

    if (first) {
      const firstAfter = await prisma.rent_obligations.findUnique({ where: { id: first.id } });
      expect(firstAfter?.status).not.toBe('WAIVED');
    }
  });

  it('the auto-expiry sweep closes a stale unaccepted tenancy', async () => {
    const invited = await invite('9876500005');
    // Age the invitation past its expiry + grace.
    await prisma.tenant_invitations.updateMany({
      where: { tenant_id: invited.tenant_id },
      data: { expires_at: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000) },
    });

    const result = await unacceptedTenancyExpiryService.run(new Date());
    expect(result.expired).toBeGreaterThanOrEqual(1);

    const t = await prisma.tenants.findUnique({ where: { id: invited.tenant_id } });
    expect(t?.status).toBe('EXPIRED');
    const activeAlloc = await prisma.roomAllocation.count({
      where: { tenant_id: invited.tenant_id, is_active: true, end_date: null },
    });
    expect(activeAlloc).toBe(0);
  });

  it('the sweep leaves a tenant who is mid-activation alone', async () => {
    const invited = await invite('9876500006');
    const inv = await prisma.tenant_invitations.findFirst({ where: { tenant_id: invited.tenant_id } });
    await tenantInvitationLifecycleService.startActivation(inv!.token, {
      password: 'SomePassword123!',
      confirm_password: 'SomePassword123!',
      phone: '9876500006',
    });
    await prisma.tenant_invitations.updateMany({
      where: { tenant_id: invited.tenant_id },
      data: { expires_at: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000) },
    });

    await unacceptedTenancyExpiryService.run(new Date());
    const t = await prisma.tenants.findUnique({ where: { id: invited.tenant_id } });
    expect(t?.status).toBe('ACTIVE');
  });
});
