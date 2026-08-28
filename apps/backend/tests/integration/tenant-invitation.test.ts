import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createTestOwner, createTestHostel } from '../factories/owner-factory';
import { createTestRoom } from '../factories/room-factory';
import { tenantInvitationLifecycleService } from '../../src/services/tenants/tenant-invitation-lifecycle-service';
import { MetaWhatsAppProvider } from '../../lib/services/notifications/providers/whatsapp/meta-provider';
import { EmailService } from '../../lib/services/email-service';
import { prisma } from '../../lib/db';
import { hostelPolicyService } from '../../lib/services/hostel-policy-service';

vi.mock('../../lib/services/email-service', () => {
  return {
    EmailService: {
      sendInvitation: vi.fn().mockResolvedValue({ sent: true } as any),
    },
  };
});

describe('Tenant Onboarding Integration Flow', () => {
  let owner: any;
  let hostel: any;
  let room: any;
  let sendInvitationSpy: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    owner = await createTestOwner();
    hostel = await createTestHostel(owner.id);
    room = await createTestRoom(hostel.id);
    
    // Default mock behavior for MetaWhatsAppProvider
    sendInvitationSpy = vi.spyOn(MetaWhatsAppProvider.prototype, 'sendInvitation');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.resetAllMocks();
  });

  it('should invite a tenant using WhatsApp only (email is optional/null)', async () => {
    sendInvitationSpy.mockResolvedValueOnce({
      providerMessageId: 'wamid.test_invite',
      attempts: 1,
    });

    const result: any = await tenantInvitationLifecycleService.createInvitation({
      name: 'Rahul Sharma',
      phone: '9876543210',
      room_id: room.id,
      monthly_rent: 8000,
    }, owner.id);

    expect(result.action).toBe('INVITED');
    expect(result.phone).toBe('+919876543210');
    expect(result.email).toBeNull();
    expect(result.whatsapp_sent).toBe(true);
    expect(result.needs_email).toBe(false);
    
    // Verify WhatsApp was called
    expect(sendInvitationSpy).toHaveBeenCalledTimes(1);
    expect(sendInvitationSpy).toHaveBeenCalledWith(expect.objectContaining({
      to: '+919876543210',
      tenantName: 'Rahul Sharma',
      roomNumber: room.room_no,
    }));

    // Verify invitation record is in database
    const dbInvite = await prisma.tenant_invitations.findUnique({
      where: { id: result.invitation_id },
    });
    expect(dbInvite).toBeTruthy();
    expect(dbInvite?.phone).toBe('+919876543210');
    expect(dbInvite?.email).toBeNull();
  });

  it('should trigger email fallback if WhatsApp fails and email is provided', async () => {
    // WhatsApp fails
    sendInvitationSpy.mockRejectedValueOnce(new Error('WhatsApp service unavailable'));
    
    // Email succeeds
    vi.mocked(EmailService.sendInvitation).mockResolvedValueOnce({
      sent: true,
    } as any);

    const result: any = await tenantInvitationLifecycleService.createInvitation({
      name: 'Rahul Sharma',
      phone: '9876543212',
      email: 'rahul2@test.com',
      room_id: room.id,
      monthly_rent: 8000,
    }, owner.id);

    expect(result.action).toBe('INVITED');
    expect(result.whatsapp_sent).toBe(false);
    expect(result.email_sent).toBe(true);
    expect(result.needs_email).toBe(false);

    expect(sendInvitationSpy).toHaveBeenCalledTimes(1);
    expect(EmailService.sendInvitation).toHaveBeenCalledTimes(1);

    // Verify database record has both email and phone
    const dbInvite = await prisma.tenant_invitations.findUnique({
      where: { id: result.invitation_id },
    });
    expect(dbInvite?.phone).toBe('+919876543212');
    expect(dbInvite?.email).toBe('rahul2@test.com');
  });

  it('should require email (needs_email: true) if WhatsApp fails and no email is provided', async () => {
    // WhatsApp fails
    sendInvitationSpy.mockRejectedValueOnce(new Error('WhatsApp service unavailable'));

    const result: any = await tenantInvitationLifecycleService.createInvitation({
      name: 'Rahul Sharma',
      phone: '9876543213',
      room_id: room.id,
      monthly_rent: 8000,
    }, owner.id);

    expect(result.action).toBe('INVITED');
    expect(result.whatsapp_sent).toBe(false);
    expect(result.email_sent).toBe(false);
    expect(result.needs_email).toBe(true);

    expect(sendInvitationSpy).toHaveBeenCalledTimes(1);
    expect(EmailService.sendInvitation).not.toHaveBeenCalled();
  });

  it('should resend invitation with email override for fallback flow', async () => {
    // 1. Create invitation without email (WhatsApp failed, needs_email is true)
    sendInvitationSpy.mockRejectedValueOnce(new Error('WhatsApp failed'));
    const initial: any = await tenantInvitationLifecycleService.createInvitation({
      name: 'Rahul Sharma',
      phone: '9876543214',
      room_id: room.id,
      monthly_rent: 8000,
    }, owner.id);

    expect(initial.needs_email).toBe(true);

    // Reset spies
    sendInvitationSpy.mockReset();
    sendInvitationSpy.mockRejectedValueOnce(new Error('WhatsApp failed on resend'));
    vi.mocked(EmailService.sendInvitation).mockClear();

    // 2. Resend invitation specifying fallback email override
    vi.mocked(EmailService.sendInvitation).mockResolvedValueOnce({
      sent: true,
    } as any);

    const resendResult: any = await tenantInvitationLifecycleService.resendInvitation(
      initial.invitation_id,
      { id: owner.id, role: 'OWNER' },
      { email: 'rahul-fallback4@test.com' }
    );

    expect(resendResult.email_sent).toBe(true);
    expect(EmailService.sendInvitation).toHaveBeenCalledTimes(1);

    // Verify that the old invitation is superseded
    const oldInvite = await prisma.tenant_invitations.findUnique({
      where: { id: initial.invitation_id },
    });
    expect(oldInvite?.status).toBe('SUPERSEDED');

    // The tenant is already ACTIVE + OWNER_MANAGED (see createInvitation) —
    // resend still updates and redispatches, but the new version is created
    // SUPERSEDED too (not PENDING), so a later click on its link routes
    // through the claim flow (CLAIM_REQUIRED) instead of normal activation,
    // which would silently no-op against a tenant who's already ACTIVE. See
    // tenant-invitation-lifecycle-service.ts's resendInvitation.
    const dbInvite = await prisma.tenant_invitations.findFirst({
      where: { tenant_id: initial.tenant_id, parent_invitation_id: initial.invitation_id },
    });
    expect(dbInvite?.status).toBe('SUPERSEDED');
    expect(dbInvite?.email).toBe('rahul-fallback4@test.com');
  });

  it('should invite a tenant with zero monthly rent', async () => {
    sendInvitationSpy.mockResolvedValueOnce({
      providerMessageId: 'wamid.test_invite_zero',
      attempts: 1,
    });

    const result: any = await tenantInvitationLifecycleService.createInvitation({
      name: 'Zero Rent Tenant',
      phone: '9876543211',
      room_id: room.id,
      monthly_rent: 0,
    }, owner.id);

    expect(result.action).toBe('INVITED');
    expect(result.whatsapp_sent).toBe(true);

    const dbTenant = await prisma.tenants.findUnique({
      where: { id: result.tenant_id },
    });
    expect(Number(dbTenant?.monthly_rent)).toBe(0);
  });

  describe('Hostel Status Hardening on Invitations', () => {
    it('should reject invitation creation when hostel is ARCHIVED or INACTIVE', async () => {
      // 1. ARCHIVED
      await prisma.hostels.update({
        where: { id: hostel.id },
        data: { status: 'ARCHIVED', is_active: false },
      });

      await expect(
        tenantInvitationLifecycleService.createInvitation({
          name: 'Blocked Tenant',
          phone: '9876543220',
          room_id: room.id,
          monthly_rent: 8000,
        }, owner.id)
      ).rejects.toThrow('VALIDATION_ERROR: Cannot invite tenant to an archived hostel');

      // 2. INACTIVE
      await prisma.hostels.update({
        where: { id: hostel.id },
        data: { status: 'INACTIVE', is_active: false },
      });

      await expect(
        tenantInvitationLifecycleService.createInvitation({
          name: 'Blocked Tenant',
          phone: '9876543220',
          room_id: room.id,
          monthly_rent: 8000,
        }, owner.id)
      ).rejects.toThrow('VALIDATION_ERROR: Cannot invite tenant to an inactive hostel');
    });

    it('should reject resending invitation when hostel is ARCHIVED or INACTIVE', async () => {
      // Restore status to active to create initial invitation
      await prisma.hostels.update({
        where: { id: hostel.id },
        data: { status: 'ACTIVE', is_active: true },
      });

      sendInvitationSpy.mockResolvedValueOnce({
        providerMessageId: 'wamid.resend_test',
        attempts: 1,
      });

      const initial: any = await tenantInvitationLifecycleService.createInvitation({
        name: 'Resend Test Tenant',
        phone: '9876543221',
        room_id: room.id,
        monthly_rent: 8000,
      }, owner.id);

      // 1. ARCHIVED
      await prisma.hostels.update({
        where: { id: hostel.id },
        data: { status: 'ARCHIVED', is_active: false },
      });

      await expect(
        tenantInvitationLifecycleService.resendInvitation(
          initial.invitation_id,
          { id: owner.id, role: 'OWNER' }
        )
      ).rejects.toThrow('VALIDATION_ERROR: Cannot resend invitation for an archived hostel');

      // 2. INACTIVE
      await prisma.hostels.update({
        where: { id: hostel.id },
        data: { status: 'INACTIVE', is_active: false },
      });

      await expect(
        tenantInvitationLifecycleService.resendInvitation(
          initial.invitation_id,
          { id: owner.id, role: 'OWNER' }
        )
      ).rejects.toThrow('VALIDATION_ERROR: Cannot resend invitation for an inactive hostel');
    });

    it('should reject resolving token (activation) when hostel is ARCHIVED or INACTIVE', async () => {
      // Restore status to active to create initial invitation
      await prisma.hostels.update({
        where: { id: hostel.id },
        data: { status: 'ACTIVE', is_active: true },
      });

      sendInvitationSpy.mockResolvedValueOnce({
        providerMessageId: 'wamid.resolve_test',
        attempts: 1,
      });

      const initial: any = await tenantInvitationLifecycleService.createInvitation({
        name: 'Resolve Test Tenant',
        phone: '9876543222',
        room_id: room.id,
        monthly_rent: 8000,
      }, owner.id);

      const dbInvite = await prisma.tenant_invitations.findUnique({
        where: { id: initial.invitation_id },
      });
      const token = dbInvite!.token;

      // 1. ARCHIVED
      await prisma.hostels.update({
        where: { id: hostel.id },
        data: { status: 'ARCHIVED', is_active: false },
      });

      await expect(
        tenantInvitationLifecycleService.resolveByToken(token)
      ).rejects.toThrow('FORBIDDEN: Cannot activate tenant in an archived hostel');

      // 2. INACTIVE
      await prisma.hostels.update({
        where: { id: hostel.id },
        data: { status: 'INACTIVE', is_active: false },
      });

      await expect(
        tenantInvitationLifecycleService.resolveByToken(token)
      ).rejects.toThrow('FORBIDDEN: Cannot activate tenant in an inactive hostel');
    });
  });

  describe('Dynamic Security Deposit Onboarding Integration', () => {
    beforeEach(async () => {
      // Ensure hostel is active and rent_cycle is MONTHLY
      await prisma.hostels.update({
        where: { id: hostel.id },
        data: { status: 'ACTIVE', is_active: true },
      });
    });

    it('should scale security deposit by rent multiplier when mode is MONTHS_OF_RENT', async () => {
      // 1. Update the hostel billing defaults policy to MONTHS_OF_RENT mode with 2 months multiplier
      await hostelPolicyService.updateHostelPolicy(
        hostel.id,
        owner.id,
        {
          billing: {
            deposit: {
              calculation_mode: 'MONTHS_OF_RENT',
              deposit_months: 2,
            }
          }
        },
        owner.id
      );

      sendInvitationSpy.mockResolvedValueOnce({
        providerMessageId: 'wamid.scale_test',
        attempts: 1,
      });

      // 2. Invite tenant without specifying explicit advance/deposit override
      const result: any = await tenantInvitationLifecycleService.createInvitation({
        name: 'Scaled Deposit Tenant',
        phone: '9876543233',
        room_id: room.id,
        monthly_rent: 12000,
      }, owner.id);

      expect(result.action).toBe('INVITED');

      // 3. Verify in database that security_deposit is calculated as monthly_rent (12000) * 2 = 24000
      const dbInvite = await prisma.tenant_invitations.findUnique({
        where: { id: result.invitation_id },
        include: { tenant: true },
      });

      expect(Number(dbInvite?.tenant.monthly_rent)).toBe(12000);
      expect(Number(dbInvite?.tenant.security_deposit)).toBe(24000);
    });

    it('should respect manual deposit override even when mode is MONTHS_OF_RENT', async () => {
      // 1. Update the hostel billing defaults policy to MONTHS_OF_RENT mode with 3 months multiplier
      await hostelPolicyService.updateHostelPolicy(
        hostel.id,
        owner.id,
        {
          billing: {
            deposit: {
              calculation_mode: 'MONTHS_OF_RENT',
              deposit_months: 3,
            }
          }
        },
        owner.id
      );

      sendInvitationSpy.mockResolvedValueOnce({
        providerMessageId: 'wamid.override_test',
        attempts: 1,
      });

      // 2. Invite tenant specifying an explicit advance_amount override of 15000 (rent is 10000)
      const result: any = await tenantInvitationLifecycleService.createInvitation({
        name: 'Overridden Deposit Tenant',
        phone: '9876543244',
        room_id: room.id,
        monthly_rent: 10000,
        advance_amount: 15000,
      }, owner.id);

      expect(result.action).toBe('INVITED');

      // 3. Verify in database that security_deposit is exactly the overridden amount (15000), not rent * 3 (30000)
      const dbInvite = await prisma.tenant_invitations.findUnique({
        where: { id: result.invitation_id },
        include: { tenant: true },
      });

      expect(Number(dbInvite?.tenant.monthly_rent)).toBe(10000);
      expect(Number(dbInvite?.tenant.security_deposit)).toBe(15000);
    });

    it('should fall back to default agreement duration from policy when not provided', async () => {
      await hostelPolicyService.updateHostelPolicy(
        hostel.id,
        owner.id,
        {
          billing: {
            invite_defaults: {
              agreement_duration_months: 9,
            }
          }
        },
        owner.id
      );

      sendInvitationSpy.mockResolvedValueOnce({
        providerMessageId: 'wamid.duration_test_1',
        attempts: 1,
      });

      const result: any = await tenantInvitationLifecycleService.createInvitation({
        name: 'Duration Test Tenant 1',
        phone: '9876543261',
        room_id: room.id,
        monthly_rent: 10000,
      }, owner.id);

      expect(result.action).toBe('INVITED');

      const dbInvite = await prisma.tenant_invitations.findUnique({
        where: { id: result.invitation_id },
      });

      expect(dbInvite?.agreement_duration_months).toBe(9);
    });

    it('should respect custom agreement duration when explicitly provided', async () => {
      await hostelPolicyService.updateHostelPolicy(
        hostel.id,
        owner.id,
        {
          billing: {
            invite_defaults: {
              agreement_duration_months: 9,
            }
          }
        },
        owner.id
      );

      sendInvitationSpy.mockResolvedValueOnce({
        providerMessageId: 'wamid.duration_test_2',
        attempts: 1,
      });

      const result: any = await tenantInvitationLifecycleService.createInvitation({
        name: 'Duration Test Tenant 2',
        phone: '9876543262',
        room_id: room.id,
        monthly_rent: 10000,
        agreement_duration_months: 6,
      }, owner.id);

      expect(result.action).toBe('INVITED');

      const dbInvite = await prisma.tenant_invitations.findUnique({
        where: { id: result.invitation_id },
      });

      expect(dbInvite?.agreement_duration_months).toBe(6);
    });
  });

  describe('Modification-driven Token Rotation, Capacity Checking, and Financial Regeneration', () => {
    it('should rotate token, check capacity, and regenerate financials on resend', async () => {
      // 1. Setup: Create another room to test capacity and room transfer
      const room2 = await createTestRoom(hostel.id);

      // Create an invitation
      sendInvitationSpy.mockResolvedValueOnce({
        providerMessageId: 'wamid.mod_test_1',
        attempts: 1,
      });

      const initial: any = await tenantInvitationLifecycleService.createInvitation({
        name: 'Mod Test Tenant',
        phone: '9876543270',
        room_id: room.id,
        monthly_rent: 10000,
        security_deposit: 20000,
      }, owner.id);

      expect(initial.action).toBe('INVITED');
      const oldToken = (await prisma.tenant_invitations.findUnique({
        where: { id: initial.invitation_id },
      }))!.token;

      // Verify initial financial obligation
      const initialObligations = await prisma.rent_obligations.findMany({
        where: { tenant_id: initial.tenant_id, obligation_type: 'SECURITY_DEPOSIT' },
      });
      expect(initialObligations.length).toBe(1);
      expect(Number(initialObligations[0].amount)).toBe(20000);

      // 2. Capacity Checking: Make room2 fully occupied by setting capacity to 0
      await prisma.rooms.update({
        where: { id: room2.id },
        data: { capacity: 0 },
      });

      // Try resending invitation with target room as room2 -> Should fail due to CAPACITY_EXCEEDED
      await expect(
        tenantInvitationLifecycleService.resendInvitation(
          initial.invitation_id,
          { id: owner.id, role: 'OWNER' },
          { room_id: room2.id }
        )
      ).rejects.toThrow(/CAPACITY_EXCEEDED/);

      // 3. Resend invitation with valid updates (different rent, deposit)
      sendInvitationSpy.mockResolvedValueOnce({
        providerMessageId: 'wamid.mod_test_2',
        attempts: 1,
      });

      const resendResult = await tenantInvitationLifecycleService.resendInvitation(
        initial.invitation_id,
        { id: owner.id, role: 'OWNER' },
        {
          monthly_rent: 12000,
          security_deposit: 24000,
        }
      );

      expect(resendResult.action).toBe('RESENT');

      // Verify old invitation is SUPERSEDED
      const supersededInvite = await prisma.tenant_invitations.findUnique({
        where: { id: initial.invitation_id },
      });
      expect(supersededInvite!.status).toBe('SUPERSEDED');
      expect(supersededInvite!.token).toBe(oldToken); // old token remains on the superseded record

      // Verify new invitation is created. The tenant is already ACTIVE +
      // OWNER_MANAGED (see createInvitation) — the resent version is created
      // SUPERSEDED too, not PENDING, for the same reason the original
      // invitation is (see resendInvitation's comment).
      const newInvite = await prisma.tenant_invitations.findFirst({
        where: { tenant_id: initial.tenant_id, parent_invitation_id: initial.invitation_id },
      });
      expect(newInvite).not.toBeNull();
      expect(newInvite!.status).toBe('SUPERSEDED');
      expect(newInvite!.token).not.toBe(oldToken);
      expect(newInvite!.parent_invitation_id).toBe(initial.invitation_id);

      // Both the original link and the resent link route through the claim
      // flow now: the tenant became this owner's ACTIVE tenant the moment
      // they were invited (see createInvitation), so neither token can go
      // through normal self-activation, which would silently no-op against
      // an already-ACTIVE tenant (see completeActivation's idempotency
      // guard). CLAIM_REQUIRED is the live path into tenancy-claim-service.ts.
      await expect(
        tenantInvitationLifecycleService.resolveByToken(oldToken)
      ).rejects.toThrow(/CLAIM_REQUIRED/);

      const resolvedError = await tenantInvitationLifecycleService
        .resolveByToken(newInvite!.token)
        .catch((err: any) => err);
      expect(String(resolvedError?.message ?? resolvedError)).toMatch(/CLAIM_REQUIRED/);

      // Verify financial regeneration (old deposit of 20000 deleted, new deposit of 24000 created)
      const updatedObligations = await prisma.rent_obligations.findMany({
        where: { tenant_id: initial.tenant_id, obligation_type: 'SECURITY_DEPOSIT' },
      });
      expect(updatedObligations.length).toBe(1);
      expect(Number(updatedObligations[0].amount)).toBe(24000);
    });

    it('should lock invitation editing and resending once a payment has been recorded', async () => {
      // Create an invitation
      sendInvitationSpy.mockResolvedValueOnce({
        providerMessageId: 'wamid.payment_lock_test',
        attempts: 1,
      });

      const initial: any = await tenantInvitationLifecycleService.createInvitation({
        name: 'Payment Lock Tenant',
        phone: '9876543271',
        room_id: room.id,
        monthly_rent: 10000,
        security_deposit: 20000,
      }, owner.id);

      // Get an obligation to link the payment to
      const dbObligation = await prisma.rent_obligations.findFirst({
        where: { tenant_id: initial.tenant_id },
      });

      // Record a payment for this tenant
      await prisma.payments.create({
        data: {
          id: crypto.randomUUID(),
          tenant_id: initial.tenant_id,
          hostel_id: hostel.id,
          obligation_id: dbObligation!.id,
          amount_paid: 5000,
          payment_method: 'CASH',
          payment_date: new Date(),
          reference_number: 'ref-123',
        },
      });

      // Try editing/resending -> should throw edit lock error
      await expect(
        tenantInvitationLifecycleService.resendInvitation(
          initial.invitation_id,
          { id: owner.id, role: 'OWNER' },
          { monthly_rent: 11000 }
        )
      ).rejects.toThrow(/Cannot edit or resend invitation after payments have been recorded/);
    });

    it('should prevent resending after 10 versions have been created', async () => {
      sendInvitationSpy.mockResolvedValue({
        providerMessageId: 'wamid.version_limit_test',
        attempts: 1,
      });

      // 1. Create initial invitation
      const initial: any = await tenantInvitationLifecycleService.createInvitation({
        name: 'Version Limit Tenant',
        phone: '9876543272',
        room_id: room.id,
        monthly_rent: 10000,
        security_deposit: 20000,
      }, owner.id);

      let currentInviteId = initial.invitation_id;

      // 2. Perform 9 resends (total of 10 versions: 1 original + 9 resends)
      for (let i = 2; i <= 10; i++) {
        await tenantInvitationLifecycleService.resendInvitation(
          currentInviteId,
          { id: owner.id, role: 'OWNER' },
          { monthly_rent: 10000 + i * 100 }
        );
        // Find the newly created invitation to resend again. The tenant is
        // already ACTIVE + OWNER_MANAGED (see createInvitation), so each new
        // version is created SUPERSEDED, not PENDING — the latest version for
        // this tenant is found by recency instead.
        const latestInvite = await prisma.tenant_invitations.findFirst({
          where: { tenant_id: initial.tenant_id },
          orderBy: { created_at: 'desc' },
        });
        currentInviteId = latestInvite!.id;
      }

      // 3. The 11th version should fail
      await expect(
        tenantInvitationLifecycleService.resendInvitation(
          currentInviteId,
          { id: owner.id, role: 'OWNER' },
          { monthly_rent: 15000 }
        )
      ).rejects.toThrow(/Maximum limit of 10 invitation versions reached/);
    }, 30000);

    it('should log the changes in event logs', async () => {
      sendInvitationSpy.mockResolvedValueOnce({
        providerMessageId: 'wamid.log_test',
        attempts: 1,
      });

      const initial: any = await tenantInvitationLifecycleService.createInvitation({
        name: 'Log Test Tenant',
        phone: '9876543273',
        room_id: room.id,
        monthly_rent: 10000,
        security_deposit: 20000,
      }, owner.id);

      sendInvitationSpy.mockResolvedValueOnce({
        providerMessageId: 'wamid.log_test_2',
        attempts: 1,
      });

      await tenantInvitationLifecycleService.resendInvitation(
        initial.invitation_id,
        { id: owner.id, role: 'OWNER' },
        {
          monthly_rent: 12000,
          security_deposit: 24000,
        }
      );

      // Verify that event log has the correct message and type
      const log = await prisma.systemEventLog.findFirst({
        where: {
          event_type: 'tenant_invitation_edited',
          owner_id: owner.id,
        },
        orderBy: { created_at: 'desc' },
      });

      expect(log).not.toBeNull();
      const metadata = log!.metadata as any;
      expect(metadata.message).toContain('Rent: "₹10,000" → "₹12,000"');
      expect(metadata.message).toContain('Deposit: "₹20,000" → "₹24,000"');
      expect(metadata.message).toContain('Invitation V2 created');
      expect(metadata.message).toContain('Invitation V1 superseded');
    });

    it('should reset onboarding progress (nullify activation dates, delete agreements & rules acceptances) on resend', async () => {
      sendInvitationSpy.mockResolvedValueOnce({
        providerMessageId: 'wamid.reset_test_1',
        attempts: 1,
      });

      const initial: any = await tenantInvitationLifecycleService.createInvitation({
        name: 'Reset Progress Tenant',
        phone: '9876543279',
        room_id: room.id,
        monthly_rent: 10000,
        security_deposit: 20000,
      }, owner.id);

      // 1. Manually update tenant to set activation timestamps, mobile_verified, document_verified, profile_completed to true
      await prisma.tenants.update({
        where: { id: initial.tenant_id },
        data: {
          activation_started_at: new Date(),
          activation_completed_at: new Date(),
          onboarding_last_activity_at: new Date(),
          mobile_verified: true,
          document_verified: true,
          profile_completed: true,
        },
      });

      // 2. Create a rule version and policy acceptance
      const ruleVersion = await prisma.ruleVersion.create({
        data: {
          hostel_id: hostel.id,
          version: 'v1-reset-test',
          title: 'Reset Test Rules',
          content_snapshot: {},
          is_active: true,
          active: true,
        }
      });

      await prisma.tenantPolicyAcceptance.create({
        data: {
          tenant_id: initial.tenant_id,
          hostel_id: hostel.id,
          rule_version_id: ruleVersion.id,
          rules_version: 'v1-reset-test',
          rules_snapshot: {},
          accepted_ip: '127.0.0.1',
          accepted_user_agent: 'test',
          typed_signature_name: 'Reset Progress Tenant',
        }
      });

      // 3. Create an agreement template and a signed agreement
      let template = await prisma.agreementTemplate.findFirst({
        where: { hostel_id: hostel.id }
      });
      if (!template) {
        template = await prisma.agreementTemplate.create({
          data: {
            id: crypto.randomUUID(),
            hostel_id: hostel.id,
            version: 'v1-reset-default',
            title: 'Reset Test Agreement',
            owner_name: 'Owner',
            custom_rules: '',
            is_active: true,
          }
        });
      }

      await prisma.agreement.create({
        data: {
          id: crypto.randomUUID(),
          tenant_id: initial.tenant_id,
          hostel_id: hostel.id,
          template_id: template.id,
          status: 'SIGNED',
          content_snapshot: {},
        }
      });

      // Assert pre-conditions
      const tenantBefore = await prisma.tenants.findUnique({ where: { id: initial.tenant_id } });
      expect(tenantBefore!.activation_started_at).not.toBeNull();
      expect(tenantBefore!.mobile_verified).toBe(true);

      const agreementsBefore = await prisma.agreement.findMany({ where: { tenant_id: initial.tenant_id } });
      expect(agreementsBefore.length).toBe(1);

      const acceptancesBefore = await prisma.tenantPolicyAcceptance.findMany({ where: { tenant_id: initial.tenant_id } });
      expect(acceptancesBefore.length).toBe(1);

      // 4. Trigger resend
      sendInvitationSpy.mockResolvedValueOnce({
        providerMessageId: 'wamid.reset_test_2',
        attempts: 1,
      });

      await tenantInvitationLifecycleService.resendInvitation(
        initial.invitation_id,
        { id: owner.id, role: 'OWNER' },
        {
          monthly_rent: 11000,
        }
      );

      // Assert post-conditions: progress dates are nullified, verification state is false, records deleted
      const tenantAfter = await prisma.tenants.findUnique({ where: { id: initial.tenant_id } });
      expect(tenantAfter!.activation_started_at).toBeNull();
      expect(tenantAfter!.activation_completed_at).toBeNull();
      expect(tenantAfter!.onboarding_last_activity_at).toBeNull();
      expect(tenantAfter!.mobile_verified).toBe(false);
      expect(tenantAfter!.document_verified).toBe(false);
      expect(tenantAfter!.profile_completed).toBe(false);

      const agreementsAfter = await prisma.agreement.findMany({ where: { tenant_id: initial.tenant_id } });
      expect(agreementsAfter.length).toBe(0);

      const acceptancesAfter = await prisma.tenantPolicyAcceptance.findMany({ where: { tenant_id: initial.tenant_id } });
      expect(acceptancesAfter.length).toBe(0);
    });

    it('should store and retrieve monthly_rent on tenant_invitations successfully', async () => {
      sendInvitationSpy.mockResolvedValueOnce({
        providerMessageId: 'wamid.rent_history_test_1',
        attempts: 1,
      });

      const initial: any = await tenantInvitationLifecycleService.createInvitation({
        name: 'Rent History Tenant',
        phone: '9876543288',
        room_id: room.id,
        monthly_rent: 9500,
      }, owner.id);

      expect(initial.action).toBe('INVITED');

      // Verify that the initial invitation has monthly_rent saved as 9500
      const dbInvite1 = await prisma.tenant_invitations.findUnique({
        where: { id: initial.invitation_id },
      });
      expect(Number(dbInvite1!.monthly_rent)).toBe(9500);

      sendInvitationSpy.mockResolvedValueOnce({
        providerMessageId: 'wamid.rent_history_test_2',
        attempts: 1,
      });

      // Edit and resend with rent 10500
      const resendResult = await tenantInvitationLifecycleService.resendInvitation(
        initial.invitation_id,
        { id: owner.id, role: 'OWNER' },
        { monthly_rent: 10500 }
      );

      expect(resendResult.action).toBe('RESENT');

      // Verify old invitation's rent is preserved as 9500
      const oldInvite = await prisma.tenant_invitations.findUnique({
        where: { id: initial.invitation_id },
      });
      expect(Number(oldInvite!.monthly_rent)).toBe(9500);

      // Verify new invitation's rent is stored as 10500. The tenant is
      // already ACTIVE + OWNER_MANAGED (see createInvitation), so this
      // version is created SUPERSEDED, not PENDING — found by parentage
      // instead.
      const newInvite = await prisma.tenant_invitations.findFirst({
        where: { tenant_id: initial.tenant_id, parent_invitation_id: initial.invitation_id },
      });
      expect(Number(newInvite!.monthly_rent)).toBe(10500);
    });
  });
}, 30000);

