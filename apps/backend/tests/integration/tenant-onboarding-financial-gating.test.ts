import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createTestOwner, createTestHostel } from '../factories/owner-factory';
import { createTestRoom } from '../factories/room-factory';
import { tenantInvitationLifecycleService } from '../../src/services/tenants/tenant-invitation-lifecycle-service';
import { MetaWhatsAppProvider } from '../../lib/services/notifications/providers/whatsapp/meta-provider';
import { EmailService } from '../../lib/services/email-service';
import { prisma } from '../../lib/db';
import { paymentService } from '../../src/services/payments/payment-service';
import { tenantFinancialLedgerService } from '../../src/services/payments/tenant-financial-ledger-service';
import { reservationStatusService } from '../../src/services/tenants/reservation-status-service';

vi.mock('../../lib/services/email-service', () => {
  return {
    EmailService: {
      sendInvitation: vi.fn().mockResolvedValue({ sent: true }),
    },
  };
});

describe('Tenant Onboarding Financial Gating Integration', () => {
  let owner: any;
  let hostel: any;
  let room: any;
  let sendInvitationSpy: any;

  beforeEach(async () => {
    owner = await createTestOwner();
    hostel = await createTestHostel(owner.id, {
      preferences_config: {
        billing: {
          deposit: {
            enabled: true,
          },
        },
      },
    });
    room = await createTestRoom(hostel.id);
    sendInvitationSpy = vi.spyOn(MetaWhatsAppProvider.prototype, 'sendInvitation').mockResolvedValue({
      providerMessageId: 'wamid.test_gating',
      attempts: 1,
    } as any);
    vi.spyOn(MetaWhatsAppProvider.prototype, 'sendTemplate').mockResolvedValue({
      providerMessageId: 'wamid.test_gating',
      attempts: 1,
      raw: {},
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('should gate room allocation to financial clearance and allocate automatically on payment', { timeout: 60000 }, async () => {
    const phone = `987${Math.floor(1000000 + Math.random() * 9000000)}`;
    const email = `gated_${Date.now()}_${Math.floor(Math.random() * 1000)}@gmail.com`;

    // 1. Create invitation for tenant with required deposit and maintenance
    const invitationResult: any = await tenantInvitationLifecycleService.createInvitation({
      name: 'Gated Tenant',
      phone,
      room_id: room.id,
      monthly_rent: 8000,
      advance_amount: 10000,
      maintenance_amount: 1500,
      maintenance_type: 'MONTHLY',
    }, owner.id);

    expect(invitationResult.action).toBe('INVITED');

    const tenantId = invitationResult.tenant_id;
    const invitationId = invitationResult.invitation_id;

    // Fetch initial invitation
    const initialInvitation = await prisma.tenant_invitations.findUnique({
      where: { id: invitationId },
    });

    // Start activation to generate the profile and link it
    const profile = await tenantInvitationLifecycleService.startActivation(
      initialInvitation!.token,
      {
        email,
        password: 'Password123!',
        confirm_password: 'Password123!',
        phone,
      }
    );

    // Fetch updated tenant and invitation details from DB
    const tenant = await prisma.tenants.findUnique({
      where: { id: tenantId },
    });
    const invitation = await prisma.tenant_invitations.findUnique({
      where: { id: invitationId },
    });

    // Verify obligations are initialized
    const obligations = await prisma.rent_obligations.findMany({
      where: { tenant_id: tenantId },
    });
    expect(obligations.length).toBe(3);
    const depositObligation = obligations.find((o: any) => o.obligation_type === 'SECURITY_DEPOSIT');
    const maintenanceObligation = obligations.find((o: any) => o.obligation_type === 'MAINTENANCE');
    const rentObligation = obligations.find((o: any) => o.obligation_type === 'RENT');
    expect(depositObligation).toBeTruthy();
    expect(maintenanceObligation).toBeTruthy();
    expect(rentObligation).toBeTruthy();

    // Verify reservation status is PAYMENT_PENDING
    let resStatus = await reservationStatusService.getReservationStatus(tenantId);
    expect(resStatus.status).toBe('PAYMENT_PENDING');

    // 2. Complete activation with unpaid obligations
    await tenantInvitationLifecycleService.completeActivation(
      invitation,
      tenant,
      profile,
      'MONTHLY',
      'Password123!'
    );

    // Verify roomAllocation record was NOT created because they are PAYMENT_PENDING
    let allocations = await prisma.roomAllocation.findMany({
      where: { tenant_id: tenantId, is_active: true },
    });
    expect(allocations.length).toBe(0);

    // Verify tenant status is active and activated_at is set
    const activatedTenant = await prisma.tenants.findUnique({
      where: { id: tenantId },
    });
    expect(activatedTenant?.status).toBe('ACTIVE');

    // 3. Pay maintenance fee
    await paymentService.recordPayment({
      hostelId: hostel.id,
      obligationId: maintenanceObligation!.id,
      amountPaid: 1500,
      paymentMethod: 'CASH',
    });

    // Reservation status should still be PAYMENT_PENDING because deposit is unpaid
    resStatus = await reservationStatusService.getReservationStatus(tenantId);
    expect(resStatus.status).toBe('PAYMENT_PENDING');

    // Room allocation should still not exist
    allocations = await prisma.roomAllocation.findMany({
      where: { tenant_id: tenantId, is_active: true },
    });
    expect(allocations.length).toBe(0);

    // 4. Pay security deposit (advance) via tenantFinancialLedgerService.credit
    await tenantFinancialLedgerService.credit({
      tenantId,
      ownerId: owner.id,
      createdBy: owner.id,
      reason: 'DEPOSIT',
      amount: 10000,
      notes: 'Onboarding deposit paid',
    });

    // Reservation status should transition to MOVE_IN_READY (both deposit and maintenance fully paid)
    resStatus = await reservationStatusService.getReservationStatus(tenantId);
    expect(resStatus.status).toBe('MOVE_IN_READY');

    // Let's assert room allocation exists now (waiting for background event handler)
    let retries = 20;
    while (retries > 0) {
      allocations = await prisma.roomAllocation.findMany({
        where: { tenant_id: tenantId, is_active: true },
      });
      if (allocations.length === 1) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
      retries--;
    }
    expect(allocations.length).toBe(1);
    expect(allocations[0].room_id).toBe(room.id);
  });
});
